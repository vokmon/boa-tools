import type { CurrentSubscription } from "@/domain/currentSubscription";
import type { PnlTotal } from "@/domain/trading";

/** One person who tried to sign in without a valid subscription and still has none. */
export interface FollowUpRow {
  email: string;
  /** False when no Wix contact has this email any more (e.g. deleted). */
  inWix: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  /** From the Wix contact field; empty when missing or not a number. */
  iqOptionId: string;
  attempts: number;
  /** Local days with at least one attempt. */
  attemptDays: number;
  lastAttempt: Date;
  /** The plan that matters now (usually the one that ended); null without any plan in Wix. */
  lastPlan: CurrentSubscription | null;
  /** Closed trades in the period per account type and currency; null when not requested or without an IQ Option id. */
  pnl: PnlTotal[] | null;
}

export interface FollowUpReportResult {
  rows: FollowUpRow[];
  /** Everyone who failed to sign in during the period. */
  failedPeople: number;
  /** Of those, how many have a valid subscription now and are left out. */
  subscribedSince: number;
}
