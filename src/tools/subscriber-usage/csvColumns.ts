import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDate, type Period } from "@/lib/date";
import type { SubscriberUsageRow } from "./types";
import { usedDaysText } from "./usedDays";
import { pnlCsvColumns } from "@/tools/shared/pnlOutput";

export function csvColumns(period: Period, rows: readonly SubscriberUsageRow[] = []): CsvColumn<SubscriberUsageRow>[] {
  const tz = period.timeZone;
  const hasUsageData = (r: SubscriberUsageRow) => r.status === "USED" || r.status === "NEVER_USED";
  return [
    { header: "status", value: (r) => r.status },
    { header: "first_name", value: (r) => r.firstName },
    { header: "last_name", value: (r) => r.lastName },
    { header: "iq_option_id", value: (r) => r.iqOptionId },
    { header: "email", value: (r) => r.email },
    { header: "phone", value: (r) => r.phone },
    { header: "days_used", value: (r) => (hasUsageData(r) ? r.daysUsed : "") },
    { header: "days_subscribed", value: (r) => r.daysSubscribed },
    { header: "used_days", value: (r) => usedDaysText(r) },
    ...pnlCsvColumns(rows, (r) => r.pnl),
    { header: "plan", value: (r) => r.plans.join(" | ") },
    { header: "subscription_end", value: (r) => (r.subscriptionEnd ? formatDate(r.subscriptionEnd, tz) : "") },
  ];
}
