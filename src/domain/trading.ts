import type { LogRow } from "@/clients/sentry/LogSearchService";

export { CLOSED_POSITION_QUERY, ORDER_PLACED_QUERY } from "./appLogs";
export const CLOSED_POSITION_FIELDS = ["message", "balance", "timestamp"] as const;

/** Written by iq-robot `sendPositionClosedEvent`: "Position closed (12.34) - order (1, 2) - user_iq: 123". */
const MESSAGE = /^Position closed \((-?\d+(?:\.\d+)?)\) - order \(([^)]*)\) - user_iq: (\d+)/;

export interface ClosedPosition {
  iqOptionId: string;
  /** The order ids, used to drop positions that were logged twice. */
  orderKey: string;
  /** Profit or loss in cents: net profit on a win, minus the stake on a loss. */
  pnlCents: number;
  /** When the log was written, i.e. when the position closed. */
  closedAt: Date;
  /** Balance type from IQ Option, e.g. "real" or "demo". */
  account: string;
  currency: string;
  /** Balance right after the position closed, when logged. */
  balanceAfter: number | null;
}

/** Totals for one person on one account type and currency. Amounts are never mixed across currencies. */
export interface PnlTotal {
  account: string;
  currency: string;
  trades: number;
  wins: number;
  losses: number;
  /** Net profit or loss, in currency units. */
  pnl: number;
}

/** Parses a "Position closed" log row. Returns null for rows without a readable amount. */
export function parseClosedPosition(row: LogRow): ClosedPosition | null {
  const match = MESSAGE.exec(String(row.message ?? ""));
  if (!match) return null;
  const [, amount, orders, iqOptionId] = match;
  const closedAt = new Date(String(row.timestamp ?? ""));
  if (Number.isNaN(closedAt.getTime())) return null;
  let account = "unknown";
  let currency = "?";
  let balanceAfter: number | null = null;
  try {
    const balance = JSON.parse(String(row.balance)) as { type?: string; currency?: string; amount?: number };
    account = balance.type ?? account;
    currency = balance.currency ?? currency;
    balanceAfter = typeof balance.amount === "number" ? balance.amount : null;
  } catch {
    // keep unknown; the amount is still valid
  }
  return {
    iqOptionId: iqOptionId!,
    orderKey: orders!.replace(/\s+/g, ""),
    pnlCents: Math.round(Number(amount) * 100),
    closedAt,
    account,
    currency,
    balanceAfter,
  };
}

/** De-duplicates by order ids and sums per IQ Option id, account type and currency. Real accounts sort first. */
export function sumByUser(positions: Iterable<ClosedPosition>): Map<string, PnlTotal[]> {
  const seen = new Set<string>();
  const totals = new Map<string, Map<string, PnlTotal & { cents: number }>>();
  for (const p of positions) {
    const dedupeKey = `${p.iqOptionId}|${p.orderKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const perUser = totals.get(p.iqOptionId) ?? new Map();
    totals.set(p.iqOptionId, perUser);
    const key = `${p.account}|${p.currency}`;
    const t = perUser.get(key) ?? { account: p.account, currency: p.currency, trades: 0, wins: 0, losses: 0, pnl: 0, cents: 0 };
    perUser.set(key, t);
    t.trades++;
    if (p.pnlCents > 0) t.wins++;
    else if (p.pnlCents < 0) t.losses++;
    t.cents += p.pnlCents;
  }
  return new Map(
    [...totals].map(([id, perUser]) => [
      id,
      [...perUser.values()]
        .map(({ cents, ...t }) => ({ ...t, pnl: cents / 100 }))
        .sort((a, b) => accountRank(a.account) - accountRank(b.account) || a.currency.localeCompare(b.currency)),
    ]),
  );
}

function accountRank(account: string): number {
  return account === "real" ? 0 : account === "demo" ? 1 : 2;
}

/** "+1,234.50" / "-20.00" */
export function formatAmount(amount: number): string {
  const text = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 ? "-" : "+"}${text}`;
}

/** "real +1,234.50 THB, demo -20.00 USD" */
export function formatPnl(totals: readonly PnlTotal[]): string {
  return totals.map((t) => `${t.account} ${formatAmount(t.pnl)} ${t.currency}`).join(", ");
}

/** Stable key used for CSV column names, e.g. "real_thb". */
export function pnlKey(t: Pick<PnlTotal, "account" | "currency">): string {
  return `${t.account}_${t.currency}`.toLowerCase();
}

export const ORDER_PLACED_FIELDS = ["message", "order", "timestamp"] as const;

/** "Order placed successfully (system) (123) 2436/USDPHP-OTC - Amount: 1000.00 - user_iq: 456" */
const ORDER_MESSAGE = /^Order placed successfully \((system|manual)\) \((\d+)\) .* - Amount: (-?\d+(?:\.\d+)?) - user_iq: (\d+)/;

export interface PlacedOrder {
  orderId: string;
  iqOptionId: string;
  /** Placed by the bot (system) rather than by hand (manual). */
  bySystem: boolean;
  stakeCents: number;
  placedAt: Date;
  account: string;
  currency: string;
}

/** Parses an "Order placed successfully" log row. Returns null for rows in another format. */
export function parsePlacedOrder(row: LogRow): PlacedOrder | null {
  const match = ORDER_MESSAGE.exec(String(row.message ?? ""));
  if (!match) return null;
  const [, kind, orderId, amount, iqOptionId] = match;
  const placedAt = new Date(String(row.timestamp ?? ""));
  if (Number.isNaN(placedAt.getTime())) return null;
  let account = "unknown";
  let currency = "?";
  try {
    const order = JSON.parse(String(row.order)) as { balanceType?: string; balanceCurrency?: string };
    account = order.balanceType ?? account;
    currency = order.balanceCurrency ?? currency;
  } catch {
    // keep unknown
  }
  return {
    orderId: orderId!,
    iqOptionId: iqOptionId!,
    bySystem: kind === "system",
    stakeCents: Math.round(Number(amount) * 100),
    placedAt,
    account,
    currency,
  };
}

/** The IQ Option id in an app log message ("... - user_iq: 123"), if any. */
export function iqOptionIdInMessage(message: unknown): string | undefined {
  return /user_iq: (\d+)/.exec(String(message ?? ""))?.[1];
}

/** Everything known about one person's trading on one account type and currency. */
export interface AccountSummary {
  account: string;
  currency: string;
  orders: number;
  botOrders: number;
  manualOrders: number;
  /** Total amount staked on placed orders. */
  stake: number;
  closed: number;
  wins: number;
  losses: number;
  /** wins / closed, 0-1; null when nothing closed. */
  winRate: number | null;
  pnl: number;
  /** Balance after the most recent closed position. */
  latestBalance: number | null;
}

/** Combines placed orders and closed positions per account type and currency, de-duplicating both. */
export function summarizeAccounts(orders: Iterable<PlacedOrder>, positions: Iterable<ClosedPosition>): AccountSummary[] {
  type Acc = AccountSummary & { stakeCents: number; pnlCents: number; balanceAt: number };
  const byKey = new Map<string, Acc>();
  const get = (account: string, currency: string): Acc => {
    const key = `${account}|${currency}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { account, currency, orders: 0, botOrders: 0, manualOrders: 0, stake: 0, closed: 0, wins: 0, losses: 0, winRate: null, pnl: 0, latestBalance: null, stakeCents: 0, pnlCents: 0, balanceAt: -Infinity };
      byKey.set(key, acc);
    }
    return acc;
  };

  const seenOrders = new Set<string>();
  for (const o of orders) {
    if (seenOrders.has(o.orderId)) continue;
    seenOrders.add(o.orderId);
    const acc = get(o.account, o.currency);
    acc.orders++;
    if (o.bySystem) acc.botOrders++;
    else acc.manualOrders++;
    acc.stakeCents += o.stakeCents;
  }

  const seenPositions = new Set<string>();
  for (const p of positions) {
    const key = `${p.iqOptionId}|${p.orderKey}`;
    if (seenPositions.has(key)) continue;
    seenPositions.add(key);
    const acc = get(p.account, p.currency);
    acc.closed++;
    if (p.pnlCents > 0) acc.wins++;
    else if (p.pnlCents < 0) acc.losses++;
    acc.pnlCents += p.pnlCents;
    if (p.balanceAfter !== null && p.closedAt.getTime() > acc.balanceAt) {
      acc.balanceAt = p.closedAt.getTime();
      acc.latestBalance = p.balanceAfter;
    }
  }

  return [...byKey.values()]
    .map(({ stakeCents, pnlCents, balanceAt: _, ...a }) => ({
      ...a,
      stake: stakeCents / 100,
      pnl: pnlCents / 100,
      winRate: a.closed ? a.wins / a.closed : null,
    }))
    .sort((a, b) => accountRank(a.account) - accountRank(b.account) || b.orders + b.closed - (a.orders + a.closed));
}
