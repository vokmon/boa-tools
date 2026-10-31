import { formatDate, formatDateTime, type Period } from "@/lib/date";
import { renderTable, type TableColumn } from "@/lib/output/table";
import { planText } from "@/tools/shared/planText";
import { pnlTableColumns } from "@/tools/shared/pnlOutput";
import type { MemberReportResult, MemberRow } from "./types";

/** A summary, then every member: active subscriptions first, then by latest login. */
export function formatMemberReport(result: MemberReportResult, timeZone: string, pnl: { period: Period; all?: boolean } | null = null): string {
  const { rows, trainingsRead } = result;
  const active = rows.filter((r) => r.subscriptionActive).length;
  const trained = rows.filter((r) => (r.trainingsCompleted ?? 0) > 0).length;
  const lines = [
    `Wix members (${timeZone})${pnl ? `, trades ${pnl.all ? "all (as far back as Sentry keeps)" : pnl.period.days[0]!.label} to ${pnl.period.days.at(-1)!.label}` : ""}`,
    `${rows.length} members: ${active} with an active subscription, ${rows.length - active} without; ` +
      (trainingsRead ? `${trained} completed a training.` : "trainings could not be read."),
    "",
  ];
  if (rows.length === 0) return [...lines, "No members."].join("\n");

  const columns: TableColumn<MemberRow>[] = [
    { value: (r) => r.firstName || "-", maxWidth: 18 },
    { value: (r) => r.lastName || "-", maxWidth: 18 },
    { value: (r) => r.email || "-", maxWidth: 36 },
    { value: (r) => r.phone || "-" },
    { value: (r) => (r.lastLogin ? `login ${formatDateTime(r.lastLogin, timeZone)}` : "never logged in") },
    ...(trainingsRead ? [{ value: (r: MemberRow) => trainingText(r, timeZone), maxWidth: 40 }] : []),
    { value: (r) => `${r.subscriptionActive ? "ACTIVE" : "inactive"}: ${planText(r.plan, timeZone)}` },
    ...(pnl ? pnlTableColumns((r: MemberRow) => r.pnl, "no IQ Option id") : []),
  ];
  return [...lines, ...renderTable(rows, columns)].join("\n");
}

function trainingText(r: MemberRow, timeZone: string): string {
  if (!r.lastTraining) return "no training";
  const when = r.lastTraining.completedAt ? ` ${formatDate(r.lastTraining.completedAt, timeZone)}` : "";
  return `${r.lastTraining.program}${when}${r.trainingsCompleted && r.trainingsCompleted > 1 ? ` (+${r.trainingsCompleted - 1})` : ""}`;
}
