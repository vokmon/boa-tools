import type { PnlTotal } from "@/domain/trading";

/** WIN / LOSS / EVEN by the real account; DEMO ONLY when the person only traded on demo. */
export type DayResult = "WIN" | "LOSS" | "EVEN" | "DEMO ONLY";

/** One person who closed at least one trade on the day. */
export interface DailyResultRow {
  iqOptionId: string;
  /** False when no Wix contact has this IQ Option id. */
  inWix: boolean;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Closed trades of the day per account type and currency, split by source. */
  pnl: PnlTotal[];
  result: DayResult;
}
