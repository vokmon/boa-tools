import type { AccountSummary } from "@/domain/trading";
import type { CurrentSubscription } from "@/domain/currentSubscription";

export type { CurrentSubscription, SubscriptionState } from "@/domain/currentSubscription";

/** Where the IQ Option id came from. Sentry is the fallback, from the login email on order logs. */
export type IqOptionIdSource = "wix" | "sentry" | "none";

export type WixMatch = "FOUND" | "MULTIPLE_CONTACTS" | "NOT_IN_WIX";

export interface UserReportRow {
  email: string;
  wixMatch: WixMatch;
  contactCount: number;
  firstName: string;
  lastName: string;
  phone: string;
  iqOptionId: string;
  iqOptionIdSource: IqOptionIdSource;
  /** Set when the Wix field is empty or not a number. */
  iqOptionIdNote: string;
  subscription: CurrentSubscription | null;
  activeDays: number;
  periodDays: number;
  lastSeen: Date | null;
  accounts: AccountSummary[];
  validationFailures: number;
  lastValidationFailure: Date | null;
}
