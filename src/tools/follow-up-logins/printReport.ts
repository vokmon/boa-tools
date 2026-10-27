import { formatDateTime, type Period } from "@/lib/date";
import { renderTable, type TableColumn } from "@/lib/output/table";
import { pnlTableColumns } from "@/tools/shared/pnlOutput";
import { lastPlanText } from "./format";
import type { FollowUpReportResult, FollowUpRow } from "./types";

/** A summary line, then the people to follow up, latest attempt first. */
export function formatFollowUpReport(result: FollowUpReportResult, period: Period, includePnl = false): string {
  const tz = period.timeZone;
  const { rows, failedPeople, subscribedSince } = result;
  const lines = [
    `Sign-in attempts without a valid subscription, ${period.days[0]!.label} to ${period.days.at(-1)!.label} (${tz})`,
    `${failedPeople} ${failedPeople === 1 ? "person" : "people"} failed to sign in; ${subscribedSince} subscribed since and ${subscribedSince === 1 ? "is" : "are"} left out.`,
    "",
  ];
  if (rows.length === 0) return [...lines, "Nobody to follow up."].join("\n");

  const columns: TableColumn<FollowUpRow>[] = [
    { value: (r) => r.firstName || "-", maxWidth: 18 },
    { value: (r) => r.lastName || "-", maxWidth: 18 },
    { value: (r) => r.email, maxWidth: 36 },
    { value: (r) => r.phone || "-" },
    { value: (r) => `${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`, align: "right" },
    { value: (r) => `last ${formatDateTime(r.lastAttempt, tz)}` },
    { value: (r) => lastPlanText(r, tz) },
    ...(includePnl ? pnlTableColumns((r: FollowUpRow) => r.pnl, "no IQ Option id") : []),
  ];
  return [...lines, `TO FOLLOW UP (${rows.length})  latest attempt first`, ...renderTable(rows, columns)].join("\n");
}
