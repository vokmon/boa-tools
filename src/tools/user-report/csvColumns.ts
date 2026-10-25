import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDate, formatDateTime } from "@/lib/date";
import { TRADE_SOURCES, type AccountSummary } from "@/domain/trading";
import type { UserReportRow } from "./types";

const round = (n: number) => Number(n.toFixed(2));

/**
 * Real and demo get the same set of columns. When someone has two currencies on one account type
 * (rare), the columns hold the one with most activity; the terminal output lists every account.
 */
function accountColumns(account: "real" | "demo"): CsvColumn<UserReportRow>[] {
  const pick = (r: UserReportRow): AccountSummary | undefined => r.accounts.find((a) => a.account === account);
  const num = (f: (a: AccountSummary) => number | null) => (r: UserReportRow) => {
    const a = pick(r);
    if (!a) return r.iqOptionId ? 0 : "";
    const v = f(a);
    return v === null ? "" : round(v);
  };
  return [
    { header: `${account}_currency`, value: (r) => pick(r)?.currency ?? "" },
    { header: `${account}_orders`, value: num((a) => a.orders) },
    { header: `${account}_bot_orders`, value: num((a) => a.botOrders) },
    { header: `${account}_manual_orders`, value: num((a) => a.manualOrders) },
    { header: `${account}_pnl`, value: num((a) => a.pnl) },
    { header: `${account}_balance`, value: (r) => (pick(r)?.latestBalance ?? "") as number | string },
    ...TRADE_SOURCES.flatMap((source): CsvColumn<UserReportRow>[] => [
      { header: `${account}_${source}_closed`, value: num((a) => a.bySource[source].trades) },
      // Percent, 0-100; empty when nothing from this source closed.
      { header: `${account}_${source}_win_rate`, value: num((a) => (a.bySource[source].trades ? (a.bySource[source].wins / a.bySource[source].trades) * 100 : null)) },
      { header: `${account}_${source}_pnl`, value: num((a) => a.bySource[source].pnl) },
    ]),
  ];
}

export function csvColumns(timeZone: string): CsvColumn<UserReportRow>[] {
  return [
    { header: "email", value: (r) => r.email },
    { header: "first_name", value: (r) => r.firstName },
    { header: "last_name", value: (r) => r.lastName },
    { header: "phone", value: (r) => r.phone },
    { header: "iq_option_id", value: (r) => r.iqOptionId },
    { header: "plan", value: (r) => r.subscription?.plan ?? "" },
    { header: "plan_type", value: (r) => r.subscription?.planType ?? "" },
    // Without a wix_match column, "not in Wix" shows here so it is not mistaken for "no subscription".
    { header: "subscription_status", value: (r) => r.subscription?.state ?? (r.wixMatch === "NOT_IN_WIX" ? "NOT_IN_WIX" : "NONE") },
    { header: "subscription_end", value: (r) => (r.subscription?.end ? formatDate(r.subscription.end, timeZone) : "") },
    { header: "last_seen", value: (r) => (r.lastSeen ? formatDateTime(r.lastSeen, timeZone) : "") },
    ...accountColumns("real"),
    ...accountColumns("demo"),
    { header: "validation_failures", value: (r) => r.validationFailures },
    { header: "last_validation_failure", value: (r) => (r.lastValidationFailure ? formatDateTime(r.lastValidationFailure, timeZone) : "") },
  ];
}
