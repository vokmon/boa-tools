import type { Period } from "@/lib/date";
import type { PnlTotal } from "@/domain/trading";

import type { PlanType } from "@/domain/subscriptions";

export type { PlanType };
export type PlanFilter = PlanType | "all";

/**
 * How a subscription is matched to the period:
 * - active: it covers at least part of the period
 * - started: its start date falls inside the period
 */
export type SubscriptionMatch = "active" | "started";
export const SUBSCRIPTION_MATCHES: readonly SubscriptionMatch[] = ["active", "started"];

/** Order also used for sorting: people to act on first, active users last. */
export const USAGE_STATUSES = [
  "NEVER_USED",
  "NO_IQ_OPTION_ID",
  "INVALID_IQ_OPTION_ID",
  "CONTACT_NOT_FOUND",
  "USED",
] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** Statuses where Sentry could not be checked, so usage is unknown. */
export const CANNOT_CHECK_STATUSES: readonly UsageStatus[] = ["NO_IQ_OPTION_ID", "INVALID_IQ_OPTION_ID", "CONTACT_NOT_FOUND"];

export const STATUS_REASONS: Record<UsageStatus, string> = {
  NEVER_USED: "no logs in the period",
  USED: "has logs in the period",
  NO_IQ_OPTION_ID: "no IQ Option id in Wix",
  INVALID_IQ_OPTION_ID: "IQ Option field is not a number",
  CONTACT_NOT_FOUND: "contact deleted in Wix",
};

export interface ReportOptions {
  period: Period;
  planFilter: PlanFilter;
  match: SubscriptionMatch;
  sentryProjectIds: string[];
  /** Sum profit/loss from "Position closed" logs. Slower: downloads every closed-position log in the period. */
  includePnl: boolean;
}

export interface DayUsage {
  /** yyyy-mm-dd */
  day: string;
  /** The subscription covered at least part of this day. */
  subscribed: boolean;
  logCount: number;
}

/** One row per Wix contact. */
export interface SubscriberUsageRow {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  iqOptionId: string;
  plans: string[];
  planTypes: PlanType[];
  subscriptionStart: Date;
  subscriptionEnd: Date | null;
  status: UsageStatus;
  daysSubscribed: number;
  daysUsed: number;
  totalLogs: number;
  days: DayUsage[];
  /** Per account type and currency; null when profit/loss was not requested. */
  pnl: PnlTotal[] | null;
}
