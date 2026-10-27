import type { CsvColumn } from "@/lib/csv/CsvWriter";
import type { TableColumn } from "@/lib/output/table";
import { formatPnl, TRADE_SOURCES, type PnlTotal } from "@/domain/trading";

const PNL_ACCOUNTS = ["real", "demo"] as const;

/** Profit/loss of one row; null when it was not requested or cannot be known for that row. */
type PnlOf<T> = (row: T) => PnlTotal[] | null;

/**
 * Terminal columns: "124 trades" and "real +1,234.50 THB (system +900.00, ...), demo ...".
 * `unknown` is shown for rows whose profit/loss is null.
 */
export function pnlTableColumns<T>(pnlOf: PnlOf<T>, unknown = "-"): TableColumn<T>[] {
  return [
    { value: (r) => { const pnl = pnlOf(r); return pnl ? `${pnl.reduce((n, t) => n + t.trades, 0)} trades` : ""; }, align: "right" },
    { value: (r) => { const pnl = pnlOf(r); return !pnl ? unknown : pnl.length ? formatPnl(pnl) : "no closed trades"; } },
  ];
}

/**
 * When any row has profit/loss: per account type, the net profit/loss and its split by source,
 * e.g. "pnl_real (THB)", "pnl_real_system (THB)", "pnl_real_manual (THB)", "pnl_real_outside (THB)".
 * The header names the most common currency; a person whose trades were in another currency gets
 * the amount with its currency, e.g. "12.50 USD", so currencies are never mixed. Rows with null
 * profit/loss are blank.
 */
export function pnlCsvColumns<T>(rows: readonly T[], pnlOf: PnlOf<T>): CsvColumn<T>[] {
  if (!rows.some((r) => pnlOf(r) !== null)) return [];
  return PNL_ACCOUNTS.flatMap((account) => {
    const currency = mainCurrency(rows, pnlOf, account);
    const column = (name: string, amountOf: (t: PnlTotal) => number): CsvColumn<T> => ({
      header: currency ? `${name} (${currency})` : name,
      value: (r: T) => {
        const pnl = pnlOf(r);
        if (pnl === null) return "";
        const totals = pnl.filter((t) => t.account === account);
        if (totals.length === 0) return 0;
        if (totals.length === 1 && totals[0]!.currency === currency) return round(amountOf(totals[0]!));
        return totals.map((t) => `${round(amountOf(t))} ${t.currency}`).join("; ");
      },
    });
    return [
      column(`pnl_${account}`, (t) => t.pnl),
      ...TRADE_SOURCES.map((source) => column(`pnl_${account}_${source}`, (t) => t.bySource[source].pnl)),
    ];
  });
}

function mainCurrency<T>(rows: readonly T[], pnlOf: PnlOf<T>, account: string): string | undefined {
  const counts = new Map<string, number>();
  for (const t of rows.flatMap((r) => pnlOf(r) ?? []).filter((t) => t.account === account)) {
    counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function round(amount: number): number {
  return Number(amount.toFixed(2));
}
