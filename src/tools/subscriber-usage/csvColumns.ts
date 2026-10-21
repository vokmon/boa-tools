import type { CsvColumn } from "@/lib/csv/CsvWriter";
import { formatDate, type Period } from "@/lib/date";
import type { SubscriberUsageRow } from "./types";
import { usedDaysText } from "./usedDays";
import type { PnlTotal } from "@/domain/trading";

const PNL_ACCOUNTS = ["real", "demo"] as const;

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
    ...pnlColumns(rows),
    { header: "plan", value: (r) => r.plans.join(" | ") },
    { header: "subscription_end", value: (r) => (r.subscriptionEnd ? formatDate(r.subscriptionEnd, tz) : "") },
  ];
}

/**
 * When profit/loss was requested: one net profit/loss column per account type, e.g.
 * "pnl_real (THB)" and "pnl_demo (USD)". The header names the most common currency; a person
 * whose trades were in another currency gets the amount with its currency, e.g. "12.50 USD",
 * so currencies are never mixed.
 */
function pnlColumns(rows: readonly SubscriberUsageRow[]): CsvColumn<SubscriberUsageRow>[] {
  if (!rows.some((r) => r.pnl !== null)) return [];
  return PNL_ACCOUNTS.map((account) => {
    const currency = mainCurrency(rows, account);
    return {
      header: currency ? `pnl_${account} (${currency})` : `pnl_${account}`,
      value: (r: SubscriberUsageRow) => {
        if (r.pnl === null) return "";
        const totals = r.pnl.filter((t) => t.account === account);
        if (totals.length === 0) return 0;
        if (totals.length === 1 && totals[0]!.currency === currency) return round(totals[0]!.pnl);
        return totals.map((t) => `${round(t.pnl)} ${t.currency}`).join("; ");
      },
    };
  });
}

function mainCurrency(rows: readonly SubscriberUsageRow[], account: string): string | undefined {
  const counts = new Map<string, number>();
  for (const t of rows.flatMap((r) => r.pnl ?? []).filter((t: PnlTotal) => t.account === account)) {
    counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function round(amount: number): number {
  return Number(amount.toFixed(2));
}
