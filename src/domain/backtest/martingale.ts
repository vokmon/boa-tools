/** Martingale and order settings, and the next stake after a loss (same rules as iq-robot). */

export type MartingaleType = "standard" | "recovery" | "cover";

export interface MartingaleSettings {
  /**
   * standard: each level stakes `multiplier` x the previous one. recovery: sized to win back all losses
   * plus a normal win. cover: sized to win back exactly the losses, so a martingale win ends at 0.
   */
  type: MartingaleType;
  multiplier: number;
  /** Martingale levels after the first order; 4 means up to 5 orders per round. */
  levels: number;
}

export interface OrderSettings {
  /** Stake of the first order, in THB. */
  amount: number;
  /** Profit on a win, in percent of the stake. */
  payout: number;
}

/** Martingale levels every setting is compared at: 0 (one order, no martingale) up to 4. More is too risky. */
export const LEVELS_TO_COMPARE: readonly number[] = [0, 1, 2, 3, 4];

export const DEFAULT_MARTINGALE: Readonly<MartingaleSettings> = Object.freeze({ type: "standard", multiplier: 2.5, levels: 4 });
/** 30 THB is the smallest order IQ Option takes. */
export const DEFAULT_ORDER: Readonly<OrderSettings> = Object.freeze({ amount: 30, payout: 85 });

/** Recovery and cover stakes are rounded up to the cent so a win never falls short (as iq-robot does). */
function roundUpTo2(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/** Stake of the next level after a loss. `lossSoFar` includes the order that just lost. */
export function nextStake(previousStake: number, lossSoFar: number, martingale: MartingaleSettings, order: OrderSettings): number {
  if (martingale.type === "recovery") return roundUpTo2(lossSoFar / (order.payout / 100) + order.amount);
  if (martingale.type === "cover") return roundUpTo2(lossSoFar / (order.payout / 100));
  return previousStake * martingale.multiplier;
}

/**
 * Profit of a round won at each level (index = level), and the loss of a round that loses every
 * level (last entry, negative). A win at level L pays its own stake x payout minus the earlier losses.
 */
export function roundOutcomes(martingale: MartingaleSettings, order: OrderSettings): number[] {
  const out: number[] = [];
  let stake = order.amount;
  let lost = 0;
  for (let level = 0; level <= martingale.levels; level++) {
    out.push((stake * order.payout) / 100 - lost);
    lost += stake;
    stake = nextStake(stake, lost, martingale, order);
  }
  out.push(-lost);
  return out;
}

/** Money at risk when every level of a round loses. */
export function worstCaseStake(martingale: MartingaleSettings, order: OrderSettings): number {
  let stake = order.amount;
  let total = stake;
  for (let level = 1; level <= martingale.levels; level++) {
    stake = nextStake(stake, total, martingale, order);
    total += stake;
  }
  return total;
}
