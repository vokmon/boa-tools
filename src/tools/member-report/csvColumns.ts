import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDate, formatDateTime } from "@/lib/date";
import { pnlCsvColumns } from "@/tools/shared/pnlOutput";
import type { MemberRow } from "./types";

export function csvColumns(timeZone: string, rows: readonly MemberRow[] = []): CsvColumn<MemberRow>[] {
  const withPnl = rows.some((r) => r.pnl !== null);
  return [
    { header: "first_name", value: (r) => r.firstName },
    { header: "last_name", value: (r) => r.lastName },
    { header: "email", value: (r) => r.email },
    { header: "phone", value: (r) => r.phone },
    { header: "last_login", value: (r) => (r.lastLogin ? formatDateTime(r.lastLogin, timeZone) : "") },
    { header: "last_training_completed", value: (r) => r.lastTraining?.program ?? "" },
    { header: "training_completed_at", value: (r) => (r.lastTraining?.completedAt ? formatDate(r.lastTraining.completedAt, timeZone) : "") },
    { header: "trainings_completed", value: (r) => r.trainingsCompleted ?? "" },
    { header: "last_plan", value: (r) => r.plan?.plan ?? "" },
    { header: "plan_type", value: (r) => r.plan?.planType ?? "" },
    { header: "plan_status", value: (r) => r.plan?.state ?? "" },
    { header: "plan_end", value: (r) => (r.plan?.end ? formatDate(r.plan.end, timeZone) : "") },
    { header: "subscription_active", value: (r) => (r.subscriptionActive ? "yes" : "no") },
    { header: "iq_option_id", value: (r) => r.iqOptionId },
    ...(withPnl ? [{ header: "trades", value: (r: MemberRow) => (r.pnl ? r.pnl.reduce((n, t) => n + t.trades, 0) : "") }] : []),
    ...pnlCsvColumns(rows, (r) => r.pnl),
  ];
}
