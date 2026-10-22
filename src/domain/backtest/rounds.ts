import type { Candle } from "@/domain/signal";
import { nextStake, type MartingaleSettings, type OrderSettings } from "./martingale";

/** Thailand has no daylight saving, so Bangkok time is always UTC+7. */
export const BANGKOK_OFFSET_S = 7 * 3600;

/** Hour of the day in Bangkok, 0-23. */
export function bangkokHour(unixSeconds: number): number {
  return Math.floor(((unixSeconds + BANGKOK_OFFSET_S) % 86_400) / 3600);
}

/** Bangkok calendar day, yyyy-mm-dd. */
export function bangkokDay(unixSeconds: number): string {
  return new Date((unixSeconds + BANGKOK_OFFSET_S) * 1000).toISOString().slice(0, 10);
}

/** How a round ended. */
export const LOST = -1;
/** The market closed (a gap in candles) before the round finished; the bot drops the chain too. */
export const STOPPED = -2;

/**
 * One signal and its orders: the first order on the next candle, then a martingale level per loss
 * until a win or the last level.
 */
export interface Round {
  activeId: number;
  /** 1 = CALL, -1 = PUT. */
  direction: number;
  /** Open of the first order's candle, unix seconds (= the signal candle's close). */
  start: number;
  /** Close of the last order's candle. */
  end: number;
  /** Level the round was won at (0 = first order, no martingale), or LOST / STOPPED. */
  wonAt: number;
  orders: number;
  /** Total money put into the round's orders. */
  staked: number;
  profit: number;
}

/** Prices the simulator reads, as arrays (SignalEngine has them), so candle objects need not stay in memory. */
export interface PriceSeries {
  readonly length: number;
  readonly from: ArrayLike<number>;
  readonly opens: ArrayLike<number>;
  readonly closes: ArrayLike<number>;
}

export function priceSeries(candles: readonly Candle[]): PriceSeries {
  return { length: candles.length, from: candles.map((c) => c.from), opens: candles.map((c) => c.open), closes: candles.map((c) => c.close) };
}

export interface SimulateOptions {
  size: number;
  martingale: MartingaleSettings;
  order: OrderSettings;
  /** Hours (Bangkok, 0-23) a round may start in; all when omitted. */
  hours?: readonly boolean[];
  /** Only rounds starting in [from, to), unix seconds. */
  from?: number;
  to?: number;
}

/**
 * Plays the bot on one asset: for each signal, a round on the following candles. The order wins if
 * its candle closes in the signal's direction, loses if against, and is a draw (repeated at the same
 * stake) if it closes where it opened. An asset never takes a signal on a candle it already had an
 * order on, so rounds of one asset never overlap.
 */
export function simulateRounds(activeId: number, prices: PriceSeries, signals: Int8Array, options: SimulateOptions): Round[] {
  const { size, martingale, order } = options;
  const { from, opens, closes } = prices;
  const rounds: Round[] = [];
  let busyUntil = -1;
  for (let i = 0; i < prices.length - 1; i++) {
    const direction = signals[i]!;
    if (direction === 0 || i <= busyUntil) continue;
    let j = i + 1;
    // The order candle must follow right away; across a gap the bot has no instrument to buy
    if (from[j]! - from[i]! !== size) continue;
    const start = from[j]!;
    if (options.from !== undefined && start < options.from) continue;
    if (options.to !== undefined && start >= options.to) continue;
    if (options.hours && !options.hours[bangkokHour(start)]) continue;

    let level = 0;
    let stake = order.amount;
    let lossSoFar = 0;
    let staked = 0;
    let profit = 0;
    let orders = 0;
    let wonAt: number;
    for (;;) {
      orders++;
      staked += stake;
      const move = direction * (closes[j]! - opens[j]!);
      if (move > 0) {
        profit += (stake * order.payout) / 100;
        wonAt = level;
        break;
      }
      if (move < 0) {
        profit -= stake;
        lossSoFar += stake;
        if (level >= martingale.levels) {
          wonAt = LOST;
          break;
        }
        level++;
        stake = nextStake(stake, lossSoFar, martingale, order);
      }
      // A draw repeats the same order on the next candle
      if (j + 1 >= prices.length || from[j + 1]! - from[j]! !== size) {
        wonAt = STOPPED;
        break;
      }
      j++;
    }
    busyUntil = j;
    rounds.push({ activeId, direction, start, end: from[j]! + size, wonAt, orders, staked, profit });
  }
  return rounds;
}
