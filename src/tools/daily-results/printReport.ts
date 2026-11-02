import { formatAmount } from "@/domain/trading";
import type { Period } from "@/lib/date";
import { renderTable, type TableColumn } from "@/lib/output/table";
import { pnlTableColumns } from "@/tools/shared/pnlOutput";
import type { DailyResultRow, DayResult } from "./types";

const RESULTS: DayResult[] = ["WIN", "LOSS", "EVEN", "DEMO ONLY"];

/** A summary, then everyone who traded: the biggest real loss first. */
export function formatDailyResults(rows: readonly DailyResultRow[], period: Period): string {
  const first = period.days[0]!.label;
  const last = period.days.at(-1)!.label;
  const lines = [`Trade results, ${first === last ? first : `${first} to ${last}`} (${period.timeZone})`];
  if (rows.length === 0) return [...lines, "", "Nobody closed a trade."].join("\n");

  const counts = RESULTS.map((r) => [r, rows.filter((x) => x.result === r).length] as const).filter(([, n]) => n > 0);
  lines.push(`${rows.length} ${rows.length === 1 ? "person" : "people"} traded: ${counts.map(([r, n]) => `${n} ${r.toLowerCase()}`).join(", ")}.`);
  lines.push(`Real, all together: ${realTotals(rows)}.`, "");

  const columns: TableColumn<DailyResultRow>[] = [
    { value: (r) => r.firstName || (r.inWix ? "-" : "not in Wix"), maxWidth: 18 },
    { value: (r) => r.lastName || "-", maxWidth: 18 },
    { value: (r) => r.email || `IQ ${r.iqOptionId}`, maxWidth: 36 },
    { value: (r) => r.phone || "-" },
    { value: (r) => r.result },
    ...pnlTableColumns((r: DailyResultRow) => r.pnl),
  ];
  return [...lines, ...renderTable(rows, columns)].join("\n");
}

/** "-1,250.00 THB, +12.00 USD": the real net per currency. */
function realTotals(rows: readonly DailyResultRow[]): string {
  const byCurrency = new Map<string, number>();
  for (const t of rows.flatMap((r) => r.pnl).filter((t) => t.account === "real")) {
    byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + Math.round(t.pnl * 100));
  }
  if (byCurrency.size === 0) return "no real trades";
  return [...byCurrency].map(([currency, cents]) => `${formatAmount(cents / 100)} ${currency}`).join(", ");
}
