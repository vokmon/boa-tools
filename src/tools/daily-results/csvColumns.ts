import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDateTime } from "@/lib/date";
import { pnlCsvColumns } from "@/tools/shared/pnlOutput";
import type { DailyResultRow } from "./types";

const total = (r: DailyResultRow, key: "trades" | "wins" | "losses") => r.pnl.reduce((n, t) => n + t[key], 0);

export function csvColumns(timeZone: string, rows: readonly DailyResultRow[] = []): CsvColumn<DailyResultRow>[] {
  const at = (d: Date | null | undefined) => (d ? formatDateTime(d, timeZone) : "");
  return [
    { header: "first_name", value: (r) => r.firstName },
    { header: "last_name", value: (r) => r.lastName },
    { header: "email", value: (r) => r.email || (r.inWix ? "" : "NOT_IN_WIX") },
    { header: "phone", value: (r) => r.phone },
    { header: "iq_option_id", value: (r) => r.iqOptionId },
    { header: "result", value: (r) => r.result },
    { header: "trades", value: (r) => total(r, "trades") },
    { header: "wins", value: (r) => total(r, "wins") },
    { header: "losses", value: (r) => total(r, "losses") },
    ...pnlCsvColumns(rows, (r) => r.pnl),
    // The running total's high and low on the real account, in that account's currency
    { header: "max_profit_real", value: (r) => r.realRange?.high ?? "" },
    { header: "max_profit_at", value: (r) => at(r.realRange?.highAt) },
    { header: "max_loss_real", value: (r) => r.realRange?.low ?? "" },
    { header: "max_loss_at", value: (r) => at(r.realRange?.lowAt) },
  ];
}
