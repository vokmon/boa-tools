import { SENTRY_ENVIRONMENT } from "@/config/constants";
import type { LogRow, LogSearchService } from "@/clients/sentry/LogSearchService";
import {
  CLOSED_POSITION_FIELDS,
  CLOSED_POSITION_QUERY,
  ORDER_PLACED_FIELDS,
  ORDER_PLACED_QUERY,
  orderSearchWindow,
  parseClosedPosition,
  parsePlacedOrder,
  sumByUser,
  type ClosedPosition,
  type PlacedOrder,
  type PnlTotal,
} from "@/domain/trading";
import type { DateWindow } from "@/lib/date";
import { logger } from "@/lib/logger";

type Logs = Pick<LogSearchService, "iterateLogs">;

export interface TradeLogScope {
  window: DateWindow;
  projectIds: readonly string[];
  /** Only this person's logs; everyone's when omitted. */
  iqOptionId?: string;
}

/** "Position closed" logs in the window. Logs without a readable amount are skipped. */
export async function readClosedPositions(logs: Logs, scope: TradeLogScope): Promise<ClosedPosition[]> {
  return read(logs, scope, scope.window, CLOSED_POSITION_QUERY, CLOSED_POSITION_FIELDS, parseClosedPosition, "closed positions");
}

/**
 * "Order placed" logs, from an hour before the window so a position opened just before it still
 * finds its order. Filter on `placedAt` before counting them as orders in the period.
 */
export async function readPlacedOrders(logs: Logs, scope: TradeLogScope): Promise<PlacedOrder[]> {
  return read(logs, scope, orderSearchWindow(scope.window), ORDER_PLACED_QUERY, ORDER_PLACED_FIELDS, parsePlacedOrder, "placed orders");
}

/** One person's profit/loss in the window, per account type and currency, split by source. */
export async function readPersonPnl(logs: Logs, scope: TradeLogScope & { iqOptionId: string }): Promise<PnlTotal[]> {
  const [positions, orders] = await Promise.all([readClosedPositions(logs, scope), readPlacedOrders(logs, scope)]);
  return sumByUser(positions, orders).get(scope.iqOptionId) ?? [];
}

async function read<T extends { iqOptionId: string }>(
  logs: Logs,
  scope: TradeLogScope,
  window: DateWindow,
  query: string,
  fields: readonly string[],
  parse: (row: LogRow) => T | null,
  label: string,
): Promise<T[]> {
  const { iqOptionId } = scope;
  const out: T[] = [];
  let scanned = 0;
  let unreadable = 0;
  for await (const row of logs.iterateLogs({
    window,
    projectIds: scope.projectIds,
    environment: SENTRY_ENVIRONMENT,
    query: iqOptionId ? `${query} message:*${iqOptionId}*` : query,
    fields,
  })) {
    if (++scanned % 1000 === 0) logger.info(`Sentry: read ${scanned} ${label}...`);
    const parsed = parse(row);
    if (!parsed) unreadable++;
    // The search matches the id anywhere in the message, so check it is this person's.
    else if (!iqOptionId || parsed.iqOptionId === iqOptionId) out.push(parsed);
  }
  if (unreadable) logger.warn(`Sentry: ${unreadable} ${label} logs could not be read and were skipped`);
  return out;
}
