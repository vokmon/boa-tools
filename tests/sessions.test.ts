import { describe, expect, test } from "bun:test";
import { DEFAULT_MARTINGALE, DEFAULT_ORDER } from "@/domain/backtest/martingale";
import { playSessions, sessionLabel, sessionStops, summarizeSessions } from "@/domain/backtest/sessions";

const DAY = "2026-10-20";
// 10:00 Bangkok on DAY, unix seconds
const TEN = Date.parse(`${DAY}T03:00:00Z`) / 1000;
/** A round starting `at` minutes after 10:00 and ending `minutes` later. */
const round = (at: number, minutes: number, profit: number, wonAt = 0) => ({ activeId: 1, direction: 1, start: TEN + at * 60, end: TEN + (at + minutes) * 60, wonAt, orders: 1, staked: 30, profit });
/** Losses after 1, 2, 3 … lost orders of 10, 25, 62.5 … THB (x2.5) */
const LOSS_AFTER = [0, 10, 35, 97.5, 253.75, 644.375];
const at10 = (rounds: ReturnType<typeof round>[], stops: { takeProfit: number | null; stopLoss: number | null }, minutes = 60, chains: "finish" | "stop" = "finish") =>
  playSessions(rounds, [DAY], { minutes }, { ...stops, lossAfter: LOSS_AFTER }, chains).find((s) => s.hour === 10)!;

describe("sessions", () => {
  test("the stops in THB follow the multiplier and the 30 THB order", () => {
    const rule = { minutes: 60, takeProfitMultiplier: 10, stopLossRounds: 1 };
    expect(sessionStops(rule, DEFAULT_MARTINGALE, DEFAULT_ORDER).takeProfit).toBe(300);
    expect(sessionStops(rule, DEFAULT_MARTINGALE, DEFAULT_ORDER).stopLoss).toBeCloseTo(-1933.125, 3);
    expect(sessionStops({ ...rule, stopLossRounds: 2 }, { ...DEFAULT_MARTINGALE, multiplier: 2.2 }, DEFAULT_ORDER).stopLoss).toBeCloseTo(-2526.816, 3);
    expect(sessionStops({ minutes: 30 }, DEFAULT_MARTINGALE, DEFAULT_ORDER)).toMatchObject({ takeProfit: null, stopLoss: null });
    // 30, 75, 187.5 … THB orders: lost after 1, 2 … orders
    expect(sessionStops({ minutes: 30 }, DEFAULT_MARTINGALE, DEFAULT_ORDER).lossAfter.slice(0, 4)).toEqual([0, 30, 105, 292.5]);
    expect(sessionLabel(rule)).toBe("60 min · take-profit 10x the first order · stop-loss 1 lost round");
    expect(sessionLabel({ minutes: 30, stopLossRounds: 2 })).toBe("30 min · no take-profit · stop-loss 2 lost rounds");
  });

  test("take-profit: once the total reaches it, no new round starts", () => {
    const s = at10([round(0, 1, 60), round(2, 1, 50), round(4, 1, 25)], { takeProfit: 100, stopLoss: -200 });
    expect(s).toEqual({ day: DAY, hour: 10, rounds: 2, profit: 110, endedBy: "takeProfit", minutes: 3 });
  });

  test("stop-loss: rounds already running finish and count, so the loss can pass the stop", () => {
    // At 6 minutes the total falls to -240 (stop); the round that started at 5 still finishes
    const s = at10([round(0, 2, -150), round(1, 5, -100), round(3, 1, 10), round(5, 1, 10), round(7, 1, 10)], { takeProfit: 100, stopLoss: -200 });
    expect(s).toEqual({ day: DAY, hour: 10, rounds: 4, profit: -230, endedBy: "stopLoss", minutes: 6 });
  });

  test("stopping the running chains instead: only the orders already placed count", () => {
    // Take-profit at minute 2; a chain that started at minute 1 is still running (it lost all 5 orders)
    const rounds = [round(0, 2, 120), round(1, 5, -644.375, -1)];
    const chain = { ...round(1, 5, -644.375, -1), orders: 5 };
    const stops = { takeProfit: 100, stopLoss: null };
    expect(at10([rounds[0]!, chain], stops)).toMatchObject({ profit: 120 - 644.375, endedBy: "takeProfit" });
    // Stopped at minute 2: its 1st order (minute 1) and 2nd (minute 2) were placed and lost, no more
    expect(at10([rounds[0]!, chain], stops, 60, "stop")).toMatchObject({ profit: 120 - 35, endedBy: "takeProfit", minutes: 2 });
  });

  test("time: rounds start until the time is up; one still running finishes", () => {
    const s = at10([round(-1, 3, 999), round(10, 1, 5), round(29, 3, 5), round(30, 1, 5)], { takeProfit: 100, stopLoss: -200 }, 30);
    // The round from before 10:00 is not part of this session; the one at 10:30 belongs to the next
    expect(s).toEqual({ day: DAY, hour: 10, rounds: 2, profit: 10, endedBy: "time", minutes: 30 });
  });

  test("a session without any round is empty, not a loss", () => {
    expect(at10([round(120, 1, 5)], { takeProfit: null, stopLoss: null })).toMatchObject({ rounds: 0, endedBy: null });
  });

  test("the summary: how sessions end, start hours best first, and the range after 20 sessions", () => {
    const stops = { takeProfit: 50, stopLoss: -100 };
    const rounds = [
      // 10:00 reaches take-profit after 2 minutes
      round(0, 2, 60),
      // 11:00 hits the stop-loss after 5 minutes
      round(60, 5, -120),
      // 12:00 runs out of time, a small win
      round(120, 1, 10),
    ];
    const sessions = playSessions(rounds, [DAY], { minutes: 30, takeProfitMultiplier: 1, stopLossRounds: 1 }, { ...stops, lossAfter: LOSS_AFTER });
    const s = summarizeSessions(sessions, { minutes: 30 }, { ...stops, lossAfter: LOSS_AFTER }, [DAY]);
    expect(s).toMatchObject({ sessions: 3, empty: 21, averageProfit: -50 / 3, best: 60, worst: -120, takeProfit: 50, stopLoss: -100 });
    expect(s.inProfitPct).toBeCloseTo(200 / 3);
    const third = expect.closeTo(100 / 3);
    expect(s.ended.takeProfit).toEqual({ pct: third, wonPct: third, lostPct: 0, lowest: 60, highest: 60, oneIn: 3, averageProfit: 60, averageMinutes: 2 });
    expect(s.ended.stopLoss).toEqual({ pct: third, wonPct: 0, lostPct: third, lowest: -120, highest: -120, oneIn: 3, averageProfit: -120, averageMinutes: 5 });
    // The time-up session made a little: in profit without reaching take-profit
    expect(s.ended.time).toMatchObject({ wonPct: third, lostPct: 0, averageMinutes: 30 });
    expect(s.hours.map((h) => h.hour)).toEqual([10, 12, 11]);
    // 20 sessions picked at random from {+60, -120, +10}: the average total is about 20 x -16.67
    expect(Math.abs(s.after20!.average - (-50 / 3) * 20)).toBeLessThan(40);
    expect(s.after20!.low).toBeLessThan(s.after20!.high);
  });
});
