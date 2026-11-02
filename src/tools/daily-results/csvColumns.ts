import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { pnlCsvColumns } from "@/tools/shared/pnlOutput";
import type { DailyResultRow } from "./types";

const total = (r: DailyResultRow, key: "trades" | "wins" | "losses") => r.pnl.reduce((n, t) => n + t[key], 0);

export function csvColumns(rows: readonly DailyResultRow[] = []): CsvColumn<DailyResultRow>[] {
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
  ];
}
