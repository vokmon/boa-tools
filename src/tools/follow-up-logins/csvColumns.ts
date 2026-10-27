import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDate, formatDateTime } from "@/lib/date";
import { pnlCsvColumns } from "@/tools/shared/pnlOutput";
import type { FollowUpRow } from "./types";

export function csvColumns(timeZone: string, rows: readonly FollowUpRow[] = []): CsvColumn<FollowUpRow>[] {
  const withPnl = rows.some((r) => r.pnl !== null);
  return [
    { header: "first_name", value: (r) => r.firstName },
    { header: "last_name", value: (r) => r.lastName },
    { header: "email", value: (r) => r.email },
    { header: "phone", value: (r) => r.phone },
    { header: "iq_option_id", value: (r) => r.iqOptionId },
    { header: "attempts", value: (r) => r.attempts },
    { header: "attempt_days", value: (r) => r.attemptDays },
    { header: "last_attempt", value: (r) => formatDateTime(r.lastAttempt, timeZone) },
    // Without a wix column, "not in Wix" shows here so it is not mistaken for "no plan".
    { header: "last_plan", value: (r) => r.lastPlan?.plan ?? (r.inWix ? "" : "NOT_IN_WIX") },
    { header: "plan_type", value: (r) => r.lastPlan?.planType ?? "" },
    { header: "plan_status", value: (r) => r.lastPlan?.state ?? "" },
    { header: "plan_end", value: (r) => (r.lastPlan?.end ? formatDate(r.lastPlan.end, timeZone) : "") },
    ...(withPnl ? [{ header: "trades", value: (r: FollowUpRow) => (r.pnl ? r.pnl.reduce((n, t) => n + t.trades, 0) : "") }] : []),
    ...pnlCsvColumns(rows, (r) => r.pnl),
  ];
}
