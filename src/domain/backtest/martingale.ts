/** Martingale and order settings, and the next stake after a loss (same rules as iq-robot). */

export type MartingaleType = "standard" | "recovery";

export interface MartingaleSettings {
  /** standard: each level stakes `multiplier` x the previous one. recovery: sized to win back all losses plus a normal win. */
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

export const DEFAULT_MARTINGALE: Readonly<MartingaleSettings> = Object.freeze({ type: "standard", multiplier: 2.5, levels: 4 });
export const DEFAULT_ORDER: Readonly<OrderSettings> = Object.freeze({ amount: 10, payout: 85 });

/** iq-robot rounds recovery stakes up to the cent so a win never falls short. */
function roundUpTo2(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/** Stake of the next level after a loss. `lossSoFar` includes the order that just lost. */
export function nextStake(previousStake: number, lossSoFar: number, martingale: MartingaleSettings, order: OrderSettings): number {
  if (martingale.type === "recovery") return roundUpTo2(lossSoFar / (order.payout / 100) + order.amount);
  return previousStake * martingale.multiplier;
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
