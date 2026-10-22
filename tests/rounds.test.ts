import { describe, expect, test } from "bun:test";
import type { Candle } from "@/domain/signal";
import { DEFAULT_MARTINGALE, DEFAULT_ORDER, nextStake, worstCaseStake } from "@/domain/backtest/martingale";
import { LOST, STOPPED, bangkokDay, bangkokHour, priceSeries, simulateRounds } from "@/domain/backtest/rounds";
import { hourRanges, summarize, type HourStat } from "@/domain/backtest/summary";

const T0 = Date.parse("2026-10-20T03:00:00Z") / 1000; // 10:00 Bangkok
const options = { size: 60, martingale: DEFAULT_MARTINGALE, order: DEFAULT_ORDER };

/** Candles from a pattern: "u" closes up, "d" down, "=" flat (draw); "|" is a 10-minute gap. */
function candles(pattern: string): Candle[] {
  const out: Candle[] = [];
  let t = T0;
  for (const p of pattern) {
    if (p === "|") {
      t += 600;
      continue;
    }
    out.push({ from: t, open: 1, close: p === "u" ? 2 : p === "d" ? 0 : 1, min: 0, max: 2 });
    t += 60;
  }
  return out;
}

function signalsAt(length: number, at: Record<number, number>): Int8Array {
  const s = new Int8Array(length);
  for (const [i, d] of Object.entries(at)) s[Number(i)] = d;
  return s;
}

describe("simulateRounds", () => {
  test("win on the first order: no martingale", () => {
    const c = candles("xu");
    const [round] = simulateRounds(1, priceSeries(c), signalsAt(2, { 0: 1 }), options);
    expect(round).toMatchObject({ wonAt: 0, orders: 1, staked: 10, profit: 8.5, start: c[1]!.from, end: c[1]!.from + 60 });
  });

  test("losses step up the stake until a win (CALL, 2.5x)", () => {
    const [round] = simulateRounds(1, priceSeries(candles("xddu")), signalsAt(4, { 0: 1 }), options);
    // stakes 10, 25, 62.5: lose 35, win 53.125
    expect(round).toMatchObject({ wonAt: 2, orders: 3, staked: 97.5, profit: 62.5 * 0.85 - 35 });
  });

  test("a PUT wins when the candle closes down", () => {
    const [round] = simulateRounds(1, priceSeries(candles("xd")), signalsAt(2, { 0: -1 }), options);
    expect(round!.wonAt).toBe(0);
  });

  test("all 5 orders lose: the round is lost", () => {
    const [round] = simulateRounds(1, priceSeries(candles("xddddd")), signalsAt(6, { 0: 1 }), options);
    expect(round).toMatchObject({ wonAt: LOST, orders: 5, staked: worstCaseStake(DEFAULT_MARTINGALE, DEFAULT_ORDER) });
    expect(round!.profit).toBeCloseTo(-(10 + 25 + 62.5 + 156.25 + 390.625));
  });

  test("a draw repeats the same order", () => {
    const [round] = simulateRounds(1, priceSeries(candles("xd=u")), signalsAt(4, { 0: 1 }), options);
    expect(round).toMatchObject({ wonAt: 1, orders: 3, staked: 10 + 25 + 25 });
  });

  test("a market gap stops the round; no round when the next candle is missing", () => {
    const [stopped] = simulateRounds(1, priceSeries(candles("xd|u")), signalsAt(3, { 0: 1 }), options);
    expect(stopped!.wonAt).toBe(STOPPED);
    expect(simulateRounds(1, priceSeries(candles("x|u")), signalsAt(2, { 0: 1 }), options)).toEqual([]);
  });

  test("no new signal on a candle the asset already traded", () => {
    // Round from signal 0 trades candles 1-2; signals at 1 and 2 are skipped, 3 starts a new round
    const rounds = simulateRounds(1, priceSeries(candles("xdudu")), signalsAt(5, { 0: 1, 1: 1, 2: -1, 3: 1 }), options);
    expect(rounds.map((r) => r.start)).toEqual([T0 + 60, T0 + 240]);
  });

  test("hours filter uses the Bangkok hour of the first order", () => {
    const allowed = Array.from({ length: 24 }, (_, h) => h === 11);
    expect(simulateRounds(1, priceSeries(candles("xu")), signalsAt(2, { 0: 1 }), { ...options, hours: allowed })).toEqual([]);
    expect(bangkokHour(T0)).toBe(10);
    expect(bangkokDay(Date.parse("2026-10-20T17:30:00Z") / 1000)).toBe("2026-10-21");
  });

  test("recovery martingale wins back the losses plus a normal win", () => {
    const recovery = { ...DEFAULT_MARTINGALE, type: "recovery" as const };
    expect(nextStake(10, 10, recovery, DEFAULT_ORDER)).toBe(21.77);
    const [round] = simulateRounds(1, priceSeries(candles("xdu")), signalsAt(3, { 0: 1 }), { ...options, martingale: recovery });
    expect(round!.profit).toBeCloseTo(21.77 * 0.85 - 10);
  });
});

describe("summarize", () => {
  const day = (d: string, hourUtc = 3) => Date.parse(`${d}T${String(hourUtc).padStart(2, "0")}:00:00Z`) / 1000;
  const round = (start: number, wonAt: number, profit: number) => ({ activeId: 1, direction: 1, start, end: start + 120, wonAt, orders: 1, staked: 10, profit });

  test("rounds, win levels, profit, losing and worst days, drop and overlap", () => {
    const days = ["2026-10-19", "2026-10-20"];
    const rounds = [
      round(day("2026-10-19"), 0, 8.5),
      round(day("2026-10-19") + 60, 1, 6),
      round(day("2026-10-20"), LOST, -100),
      round(day("2026-10-20") + 600, 0, 8.5),
      round(day("2026-10-20") + 700, STOPPED, -10),
      round(day("2026-10-25"), 0, 8.5), // outside the test days
    ];
    const s = summarize(rounds, days, 4);
    expect(s).toMatchObject({
      days: 2,
      rounds: 5,
      roundsPerDay: 2.5,
      roundWinPct: 75,
      wonAtLevel: [2, 1, 0, 0, 0],
      lost: 1,
      stopped: 1,
      fullLossEveryDays: 2,
      profit: 8.5 + 6 - 100 + 8.5 - 10,
      losingDays: 1,
      worstDay: { day: "2026-10-20", profit: -101.5 },
      biggestDrop: -101.5, // peak 14.5, then -100, +8.5, -10
      mostAtOnce: 2,
    });
  });

  test("hour windows merge neighbouring hours", () => {
    const status = (h: number) => (h >= 7 && h < 11 ? "good" : h === 15 || h === 16 ? "avoid" : "ok");
    const hours = Array.from({ length: 24 }, (_, hour): HourStat => ({ hour, rounds: 50, won: 49, profit: 1, status: status(hour) }));
    expect(hourRanges(hours, "good")).toEqual(["07-11"]);
    expect(hourRanges(hours, "avoid")).toEqual(["15-17"]);
  });
});
