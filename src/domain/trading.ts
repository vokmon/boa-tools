import type { LogRow } from "@/clients/sentry/LogSearchService";
import type { DateWindow } from "@/lib/date";

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

/**
 * Where a closed position was placed from: the bot (system) or by hand in the app (manual), as the
 * app's "Order placed" log says; outside when the app never logged the order, i.e. it was placed
 * directly in IQ Option while the app was open.
 */
export const TRADE_SOURCES = ["system", "manual", "outside"] as const;
export type TradeSource = (typeof TRADE_SOURCES)[number];

/** Results of closed positions. */
export interface TradeResult {
  trades: number;
  wins: number;
  losses: number;
  /** Net profit or loss, in currency units. */
  pnl: number;
}

/** Totals for one person on one account type and currency. Amounts are never mixed across currencies. */
export interface PnlTotal extends TradeResult {
  account: string;
  currency: string;
  /** The same totals split by where the positions were placed from; they add up to the totals. */
  bySource: Record<TradeSource, TradeResult>;
}

/** Order logs are searched from this long before the period, so a position opened just before it still finds its order. */
export const ORDER_LOOKBACK_MS = 60 * 60_000;

export function orderSearchWindow(window: DateWindow): DateWindow {
  return { start: new Date(window.start.getTime() - ORDER_LOOKBACK_MS), end: window.end };
}

/** Placed orders by order id, for `sourceOf`. */
export function indexOrders(orders: Iterable<PlacedOrder>): Map<string, PlacedOrder> {
  const byId = new Map<string, PlacedOrder>();
  for (const o of orders) byId.set(o.orderId, o);
  return byId;
}

export function sourceOf(position: ClosedPosition, ordersById: ReadonlyMap<string, PlacedOrder>): TradeSource {
  for (const id of position.orderKey.split(",")) {
    const order = ordersById.get(id);
    if (order) return order.bySystem ? "system" : "manual";
  }
  return "outside";
}

/** Running totals in cents, so sums have no float drift. */
type Tally = { trades: number; wins: number; losses: number; cents: number };
const emptyTally = (): Tally => ({ trades: 0, wins: 0, losses: 0, cents: 0 });
const emptyTallies = (): Record<TradeSource, Tally> => ({ system: emptyTally(), manual: emptyTally(), outside: emptyTally() });

function addResult(t: Tally, pnlCents: number): void {
  t.trades++;
  if (pnlCents > 0) t.wins++;
  else if (pnlCents < 0) t.losses++;
  t.cents += pnlCents;
}

function toResult({ cents, ...t }: Tally): TradeResult {
  return { ...t, pnl: cents / 100 };
}

function toResults(tallies: Record<TradeSource, Tally>): Record<TradeSource, TradeResult> {
  return { system: toResult(tallies.system), manual: toResult(tallies.manual), outside: toResult(tallies.outside) };
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

/**
 * De-duplicates by order ids and sums per IQ Option id, account type and currency, split by source
 * using the placed orders. Real accounts sort first.
 */
export function sumByUser(positions: Iterable<ClosedPosition>, orders: Iterable<PlacedOrder>): Map<string, PnlTotal[]> {
  type Acc = { account: string; currency: string; total: Tally; bySource: Record<TradeSource, Tally> };
  const ordersById = indexOrders(orders);
  const seen = new Set<string>();
  const totals = new Map<string, Map<string, Acc>>();
  for (const p of positions) {
    const dedupeKey = `${p.iqOptionId}|${p.orderKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const perUser = totals.get(p.iqOptionId) ?? new Map<string, Acc>();
    totals.set(p.iqOptionId, perUser);
    const key = `${p.account}|${p.currency}`;
    const acc = perUser.get(key) ?? { account: p.account, currency: p.currency, total: emptyTally(), bySource: emptyTallies() };
    perUser.set(key, acc);
    addResult(acc.total, p.pnlCents);
    addResult(acc.bySource[sourceOf(p, ordersById)], p.pnlCents);
  }
  return new Map(
    [...totals].map(([id, perUser]) => [
      id,
      [...perUser.values()]
        .map((a): PnlTotal => ({ account: a.account, currency: a.currency, ...toResult(a.total), bySource: toResults(a.bySource) }))
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

/** "real +1,234.50 THB (system +900.00, manual +400.00, outside -65.50), demo -20.00 USD (system -20.00)" */
export function formatPnl(totals: readonly PnlTotal[]): string {
  return totals.map((t) => `${t.account} ${formatAmount(t.pnl)} ${t.currency} (${formatSources(t.bySource)})`).join(", ");
}

/** "system +900.00, outside -65.50"; sources without trades are left out. */
function formatSources(bySource: Record<TradeSource, TradeResult>): string {
  return TRADE_SOURCES.filter((s) => bySource[s].trades > 0)
    .map((s) => `${s} ${formatAmount(bySource[s].pnl)}`)
    .join(", ");
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
  /** Closed positions split by where they were placed from; they add up to closed, wins, losses and pnl. */
  bySource: Record<TradeSource, TradeResult>;
}

/**
 * Combines placed orders and closed positions per account type and currency, de-duplicating both.
 * `knownOrders` are the orders used to tell where a position came from; pass a wider set than
 * `orders` (e.g. from just before the period) so those positions are not counted as outside.
 */
export function summarizeAccounts(
  orders: Iterable<PlacedOrder>,
  positions: Iterable<ClosedPosition>,
  knownOrders: Iterable<PlacedOrder> = orders,
): AccountSummary[] {
  type Acc = Omit<AccountSummary, "bySource"> & { stakeCents: number; pnlCents: number; balanceAt: number; bySource: Record<TradeSource, Tally> };
  const ordersById = indexOrders(knownOrders);
  const byKey = new Map<string, Acc>();
  const get = (account: string, currency: string): Acc => {
    const key = `${account}|${currency}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { account, currency, orders: 0, botOrders: 0, manualOrders: 0, stake: 0, closed: 0, wins: 0, losses: 0, winRate: null, pnl: 0, latestBalance: null, stakeCents: 0, pnlCents: 0, balanceAt: -Infinity, bySource: emptyTallies() };
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
    addResult(acc.bySource[sourceOf(p, ordersById)], p.pnlCents);
    if (p.balanceAfter !== null && p.closedAt.getTime() > acc.balanceAt) {
      acc.balanceAt = p.closedAt.getTime();
      acc.latestBalance = p.balanceAfter;
    }
  }

  return [...byKey.values()]
    .map(({ stakeCents, pnlCents, balanceAt: _, bySource, ...a }) => ({
      ...a,
      stake: stakeCents / 100,
      pnl: pnlCents / 100,
      winRate: a.closed ? a.wins / a.closed : null,
      bySource: toResults(bySource),
    }))
    .sort((a, b) => accountRank(a.account) - accountRank(b.account) || b.orders + b.closed - (a.orders + a.closed));
}
