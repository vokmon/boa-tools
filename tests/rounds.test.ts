import { describe, expect, test } from "bun:test";
import type { Candle } from "@/domain/signal";
import { DEFAULT_MARTINGALE, nextStake, worstCaseStake } from "@/domain/backtest/martingale";
import { LOST, STOPPED, bangkokDay, bangkokHour, limitOpenRounds, priceSeries, simulateRounds } from "@/domain/backtest/rounds";
import { groupSplit, hourRanges, isWeekend, summarize, type HourStat } from "@/domain/backtest/summary";

const T0 = Date.parse("2026-10-20T03:00:00Z") / 1000; // 10:00 Bangkok
/** A 10 THB order keeps the stake arithmetic below easy to read (the bot's default is 30). */
const TEN = { amount: 10, payout: 85 };
const options = { size: 60, martingale: DEFAULT_MARTINGALE, order: TEN };

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
    expect(round).toMatchObject({ wonAt: LOST, orders: 5, staked: worstCaseStake(DEFAULT_MARTINGALE, TEN) });
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
    expect(nextStake(10, 10, recovery, TEN)).toBe(21.77);
    const [round] = simulateRounds(1, priceSeries(candles("xdu")), signalsAt(3, { 0: 1 }), { ...options, martingale: recovery });
    expect(round!.profit).toBeCloseTo(21.77 * 0.85 - 10);
  });
});

describe("cover martingale", () => {
  test("each level wins back exactly the losses: a round won by martingale ends at 0", () => {
    const cover = { ...DEFAULT_MARTINGALE, type: "cover" as const };
    const order = { amount: 30, payout: 85 };
    expect(nextStake(30, 30, cover, order)).toBe(35.3);
    expect(nextStake(35.3, 65.3, cover, order)).toBe(76.83);
    const [round] = simulateRounds(1, priceSeries(candles("xddu")), signalsAt(4, { 0: 1 }), { ...options, order, martingale: cover });
    expect(round!.wonAt).toBe(2);
    expect(round!.profit).toBeGreaterThanOrEqual(0);
    expect(round!.profit).toBeLessThan(0.02);
  });
});

describe("limitOpenRounds", () => {
  const r = (activeId: number, startMin: number, endMin: number) => ({ activeId, direction: 1, start: T0 + startMin * 60, end: T0 + endMin * 60, wonAt: 0, orders: 1, staked: 30, profit: 25.5 });

  test("skips a round while the limit is reached; same minute: lower asset id first", () => {
    const rounds = [r(2, 0, 2), r(1, 0, 2), r(3, 1, 3), r(4, 2, 4), r(5, 2, 3)];
    // One at a time: asset 1 at 0:00; 2 and 3 are skipped while it runs; it ends at 0:02, so 4 starts
    expect(limitOpenRounds(rounds, 1).map((x) => x.activeId)).toEqual([1, 4]);
    expect(limitOpenRounds(rounds, 2).map((x) => x.activeId)).toEqual([1, 2, 4, 5]);
    expect(limitOpenRounds(rounds, 0)).toHaveLength(5);
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
      roundsPerHour: 2.5 / 24,
      roundWinPct: 75,
      firstWinPct: 50,
      wonAtLevel: [2, 1, 0, 0, 0],
      lost: 1,
      stopped: 1,
      fullLossEveryDays: 2,
      profit: 8.5 + 6 - 100 + 8.5 - 10,
      losingDays: 1,
      worstDay: { day: "2026-10-20", profit: -101.5 },
      biggestDrop: -101.5, // peak 14.5, then -100, +8.5, -10
      mostAtOnce: 2,
      // Two days make two parts, one day each; the stopped round does not count
      parts: [
        { from: "2026-10-19", to: "2026-10-19", roundsPerDay: 2, firstWinPct: 50, ends: [50, 50, 0, 0, 0, 0] },
        { from: "2026-10-20", to: "2026-10-20", roundsPerDay: 2, firstWinPct: 50, ends: [50, 0, 0, 0, 0, 50] },
      ],
    });
  });

  test("rounds per hour and the quiet stretch only count the hours a setting trades", () => {
    const days = ["2026-10-19", "2026-10-20"];
    // 10:00, 10:01 Bangkok on the 19th; 10:00, 10:10, 10:11 on the 20th
    const rounds = [day("2026-10-19"), day("2026-10-19") + 60, day("2026-10-20"), day("2026-10-20") + 600, day("2026-10-20") + 700].map((t) => round(t, 0, 8.5));
    const tenOnly = Array.from({ length: 24 }, (_, h) => h === 10);
    // All day: the wait overnight counts as quiet too
    expect(summarize(rounds, days, 4)).toMatchObject({ roundsPerHour: 5 / 48, quietMinutes: 1439 });
    // Trading 10:00-11:00 only: waits 1, 10 and 1 minute; the overnight break is not a quiet stretch
    expect(summarize(rounds, days, 4, tenOnly)).toMatchObject({ roundsPerHour: 2.5, quietMinutes: 10 });
    expect(summarize([], days, 4).quietMinutes).toBeNull();
  });

  test("weekdays and the weekend are counted per day of their own kind", () => {
    expect([isWeekend("2026-10-17"), isWeekend("2026-10-18"), isWeekend("2026-10-19")]).toEqual([true, true, false]);
    const days = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]; // Sat, Sun, Mon, Tue
    const rounds = [
      round(day("2026-10-17"), 0, 8.5), // Saturday: one first-order win
      round(day("2026-10-19"), 0, 8.5), // Monday: a first-order win and a loss
      round(day("2026-10-19") + 60, LOST, -100),
      round(day("2026-10-20"), 1, 6), // Tuesday: won at martingale 1
    ];
    const split = groupSplit(rounds, days, 1);
    expect(split.weekend).toEqual({ days: 2, roundsPerDay: 0.5, firstWinPct: 100, ends: [100, 0, 0], profitPerDay: 4.25 });
    // Monday and Tuesday: a first-order win, a win at martingale 1, a lost round
    expect(split.weekdays.ends.map((p) => Math.round(p))).toEqual([33, 33, 33]);
    expect(split.weekdays).toMatchObject({ days: 2, roundsPerDay: 1.5, profitPerDay: (8.5 - 100 + 6) / 2 });
    expect(split.weekdays.firstWinPct).toBeCloseTo(100 / 3);
    // Fewer than 14 days: the newest 2 weeks are all of them
    expect(split.last2Weeks).toMatchObject({ days: 4, roundsPerDay: 1, firstWinPct: 50 });
  });

  test("hour windows merge neighbouring hours", () => {
    const status = (h: number) => (h >= 7 && h < 11 ? "good" : h === 15 || h === 16 ? "avoid" : "ok");
    const hours = Array.from({ length: 24 }, (_, hour): HourStat => ({ hour, rounds: 50, won: 49, firstWon: 25, profit: 1, status: status(hour) }));
    expect(hourRanges(hours, "good")).toEqual(["07-11"]);
    expect(hourRanges(hours, "avoid")).toEqual(["15-17"]);
  });
});
