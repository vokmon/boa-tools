import { formatDate, type Period } from "@/lib/date";
import { renderTable, type TableColumn } from "@/lib/output/table";
import { CANNOT_CHECK_STATUSES, STATUS_REASONS, type PlanFilter, type SubscriberUsageRow, type SubscriptionMatch } from "./types";
import { usedDaysText } from "./usedDays";
import { formatPnl } from "@/domain/trading";

export interface FormatReportOptions {
  period: Period;
  planFilter: PlanFilter;
  match?: SubscriptionMatch;
  includePnl?: boolean;
}

const PLAN_TITLE: Record<PlanFilter, string> = { trial: "Trial subscribers", paid: "Paid subscribers", all: "Subscribers" };

const person: TableColumn<SubscriberUsageRow>[] = [
  { value: (r) => r.firstName || "-", maxWidth: 18 },
  { value: (r) => r.lastName || "-", maxWidth: 18 },
  { value: (r) => r.iqOptionId || "-", maxWidth: 12 },
  { value: (r) => r.email || "-", maxWidth: 36 },
  { value: (r) => r.phone || "-" },
];

/** The report as people-first lines: never used, cannot check, then used (most active first). */
export function formatReport(rows: SubscriberUsageRow[], options: FormatReportOptions): string {
  const { period, planFilter, match = "active", includePnl = false } = options;
  const tz = period.timeZone;
  const neverUsed = rows.filter((r) => r.status === "NEVER_USED");
  const cannotCheck = rows.filter((r) => CANNOT_CHECK_STATUSES.includes(r.status));
  const used = rows.filter((r) => r.status === "USED");
  const ends = (r: SubscriberUsageRow) => (r.subscriptionEnd ? `ends ${formatDate(r.subscriptionEnd, tz)}` : "no end date");

  const lines = [
    `${PLAN_TITLE[planFilter]} ${match === "started" ? "who started" : "active"} ${period.days[0]!.label} to ${period.days.at(-1)!.label} (${tz})`,
    "",
    ...section(`NEVER USED (${neverUsed.length})  candidates to switch off`, neverUsed, [...person, { value: ends }]),
    ...section(`CANNOT CHECK (${cannotCheck.length})  fix in Wix before deciding`, cannotCheck, [
      ...person,
      { value: (r) => STATUS_REASONS[r.status] },
    ]),
    ...section(`USED (${used.length})  most active first`, used, [
      ...person,
      { value: (r) => `${r.daysUsed}/${r.daysSubscribed} days`, align: "right" },
      { value: usedDaysText },
      ...(includePnl ? pnlColumns : []),
    ]),
  ];
  return lines.join("\n");
}

const pnlColumns: TableColumn<SubscriberUsageRow>[] = [
  { value: (r) => `${(r.pnl ?? []).reduce((n, t) => n + t.trades, 0)} trades`, align: "right" },
  { value: (r) => (r.pnl?.length ? formatPnl(r.pnl) : "no closed trades") },
];

function section(title: string, rows: SubscriberUsageRow[], columns: TableColumn<SubscriberUsageRow>[]): string[] {
  if (rows.length === 0) return [];
  return [title, ...renderTable(rows, columns), ""];
}
