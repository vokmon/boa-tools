import type { CurrentSubscription } from "@/domain/currentSubscription";
import type { PnlTotal } from "@/domain/trading";

export interface CompletedTraining {
  program: string;
  /** Wix keeps no completion date; this is the last activity, i.e. the last step done. */
  completedAt: Date | null;
}

/** One Wix site member. */
export interface MemberRow {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  /** Last login to the Wix site; null when they never logged in. */
  lastLogin: Date | null;
  /** From the Wix contact field; empty when missing or not a number. */
  iqOptionId: string;
  /** The most recently completed online program; null when none, or when trainings could not be read. */
  lastTraining: CompletedTraining | null;
  /** Online programs completed; null when trainings could not be read. */
  trainingsCompleted: number | null;
  /** The plan that matters now; null without any plan in Wix. */
  plan: CurrentSubscription | null;
  /** An ACTIVE plan that has not ended, or a PENDING (paid) one. */
  subscriptionActive: boolean;
  /** Closed trades in the period per account type and currency; null when not requested or without an IQ Option id. */
  pnl: PnlTotal[] | null;
}

export interface MemberReportResult {
  rows: MemberRow[];
  /** False when Wix refused the Online Programs calls (the API key needs that permission). */
  trainingsRead: boolean;
}
