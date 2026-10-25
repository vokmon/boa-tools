import type { AccountSummary } from "@/domain/trading";
import { formatAmount, TRADE_SOURCES } from "@/domain/trading";
import { formatDate } from "@/lib/date";
import type { CurrentSubscription, UserReportRow } from "./types";

export function money(amount: number): string {
  return Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function percent(rate: number | null): string {
  return rate === null ? "-" : `${Math.round(rate * 100)}%`;
}

export function subscriptionText(s: CurrentSubscription | null, timeZone: string): string {
  if (!s) return "no subscription in Wix";
  const ends = s.end ? `ends ${formatDate(s.end, timeZone)}` : "no end date";
  const left = s.daysLeft !== null ? ` (${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left)` : "";
  const other = s.otherPlans ? `, ${s.otherPlans} other plan${s.otherPlans === 1 ? "" : "s"}` : "";
  const when = s.state === "UPCOMING" ? `starts ${formatDate(s.start, timeZone)}` : ends;
  return `${s.plan || "?"} (${s.planType}), ${s.state}, ${when}${left}${other}`;
}

export function accountText(a: AccountSummary): string {
  const balance = a.latestBalance !== null ? `, balance ${money(a.latestBalance)}` : "";
  return (
    `${a.orders} orders (${a.botOrders} bot, ${a.manualOrders} manual), stake ${money(a.stake)}, ` +
    `${a.closed} closed, win rate ${percent(a.winRate)}, P/L ${formatAmount(a.pnl)}${balance}`
  );
}

/** "system 10 closed, win rate 60%, P/L +900.00; outside 2 closed, ..."; sources without closed positions are left out. */
export function sourcesText(a: AccountSummary): string {
  return TRADE_SOURCES.filter((s) => a.bySource[s].trades > 0)
    .map((s) => {
      const r = a.bySource[s];
      return `${s} ${r.trades} closed, win rate ${percent(r.wins / r.trades)}, P/L ${formatAmount(r.pnl)}`;
    })
    .join("; ");
}

export function displayName(r: UserReportRow): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "-";
}
