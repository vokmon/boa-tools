import { SENTRY_CONCURRENCY, SENTRY_DATASETS, SENTRY_ENVIRONMENT } from "@/config/constants";
import { iqOptionIdOf, toSubscriptionOrder, type SubscriptionOrder } from "@/domain/subscriptions";
import type { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import type { WixContact } from "@/clients/wix/types";
import type { ContactsService } from "@/clients/wix/ContactsService";
import type { MessageTimeseriesService } from "@/clients/sentry/MessageTimeseriesService";
import type { LogSearchService } from "@/clients/sentry/LogSearchService";
import { groupBy, uniq } from "@/lib/collections";
import { mapWithConcurrency } from "@/lib/concurrency";
import { dayKeyOf, overlaps, type Period } from "@/lib/date";
import { logger } from "@/lib/logger";
import { matchesPlanFilter, planTypeOf } from "./planType";
import { sumByUser, type PnlTotal } from "@/domain/trading";
import { readClosedPositions, readPlacedOrders } from "@/tools/shared/tradeLogs";
import { USAGE_STATUSES, type ReportOptions, type SubscriberUsageRow, type UsageStatus } from "./types";

/** Pick only the service methods used, so tests can pass small fakes. */
export interface ReportDependencies {
  orders: Pick<PricingPlanOrdersService, "listOrders">;
  contacts: Pick<ContactsService, "getContactsByIds">;
  usage: Pick<MessageTimeseriesService, "countMessagesContaining">;
  logs: Pick<LogSearchService, "iterateLogs">;
}

/** Joins Wix subscribers with daily Sentry usage. The only place that knows about both systems. */
export class SubscriberUsageReport {
  constructor(private readonly deps: ReportDependencies) {}

  async build(options: ReportOptions): Promise<SubscriberUsageRow[]> {
    if (options.sentryProjectIds.length === 0) throw new Error("Select at least one Sentry project");
    const { period } = options;

    const allOrders = await this.deps.orders.listOrders();
    const usable = allOrders.flatMap((o) => toSubscriptionOrder(o) ?? []);
    if (usable.length < allOrders.length) {
      logger.warn(`Wix: skipped ${allOrders.length - usable.length} orders without a contact or start date`);
    }
    const orders = usable.filter(
      (o) => matchesPeriod(o, options) && matchesPlanFilter(o.order, options.planFilter),
    );
    logger.info(`Wix: ${allOrders.length} orders, ${orders.length} match the period and plan type`);

    const ordersByContact = groupBy(orders, (o) => o.contactId);
    const contacts = await this.deps.contacts.getContactsByIds(ordersByContact.keys());
    logger.info(`Wix: ${ordersByContact.size} subscribers, ${contacts.size} contacts found`);

    const rows = [...ordersByContact].map(([contactId, contactOrders]) =>
      toRow(contactId, contactOrders, contacts.get(contactId), period),
    );

    const usageById = await this.dailyUsage(rows, options);
    for (const row of rows) {
      const perDay = usageById.get(row.iqOptionId);
      if (!perDay || row.status !== "NEVER_USED") continue;
      // Only days covered by a matching subscription count; usage under other plans is ignored.
      for (const day of row.days) day.logCount = day.subscribed ? (perDay.get(day.day) ?? 0) : 0;
      row.totalLogs = row.days.reduce((sum, d) => sum + d.logCount, 0);
      row.daysUsed = row.days.filter((d) => d.logCount > 0).length;
      if (row.totalLogs > 0) row.status = "USED";
    }

    if (options.includePnl) {
      const pnlById = await this.profitAndLoss(rows, options);
      for (const row of rows) if (row.status === "USED" || row.status === "NEVER_USED") row.pnl = pnlById.get(row.iqOptionId) ?? [];
    }
    return rows.sort(compareRows);
  }

  /** Sums closed positions in the period for the subscribers in `rows`, keyed by IQ Option id. */
  private async profitAndLoss(rows: SubscriberUsageRow[], options: ReportOptions): Promise<Map<string, PnlTotal[]>> {
    // Subscribed days per IQ Option id; trades on other days belong to other plans and are left out.
    const subscribedDays = new Map<string, Set<string>>();
    for (const r of rows.filter((r) => r.status === "USED")) {
      const days = subscribedDays.get(r.iqOptionId) ?? new Set<string>();
      for (const d of r.days) if (d.subscribed) days.add(d.day);
      subscribedDays.set(r.iqOptionId, days);
    }
    const scope = { window: options.period.window, projectIds: options.sentryProjectIds };
    const [allPositions, allOrders] = await Promise.all([readClosedPositions(this.deps.logs, scope), readPlacedOrders(this.deps.logs, scope)]);
    const positions = allPositions.filter((p) => subscribedDays.get(p.iqOptionId)?.has(dayKeyOf(p.closedAt, options.period.timeZone)));
    const orders = allOrders.filter((o) => subscribedDays.has(o.iqOptionId));
    logger.info(`Sentry: ${allPositions.length} closed positions and ${allOrders.length} placed orders read, ${positions.length} and ${orders.length} belong to these subscribers`);
    return sumByUser(positions, orders);
  }

  /** Log counts per local day, keyed by IQ Option id, for every row with a valid id. */
  private async dailyUsage(rows: SubscriberUsageRow[], options: ReportOptions): Promise<Map<string, Map<string, number>>> {
    const ids = uniq(rows.filter((r) => r.status === "NEVER_USED").map((r) => r.iqOptionId));
    logger.info(`Sentry: checking ${ids.length} IQ Option ids`);
    let done = 0;
    const results = await mapWithConcurrency(ids, SENTRY_CONCURRENCY, async (id) => {
      const buckets = await this.deps.usage.countMessagesContaining(id, {
        window: options.period.window,
        projectIds: options.sentryProjectIds,
        datasets: SENTRY_DATASETS,
        environment: SENTRY_ENVIRONMENT,
      });
      const perDay = new Map<string, number>();
      for (const bucket of buckets) {
        const key = dayKeyOf(bucket.start, options.period.timeZone);
        perDay.set(key, (perDay.get(key) ?? 0) + bucket.count);
      }
      logger.debug(`Sentry: ${++done}/${ids.length} ${id} -> ${buckets.reduce((s, b) => s + b.count, 0)} logs`);
      return [id, perDay] as const;
    });
    return new Map(results);
  }
}

function matchesPeriod(order: SubscriptionOrder, { period, match }: ReportOptions): boolean {
  if (match === "started") return order.start >= period.window.start && order.start <= period.window.end;
  return overlaps(period.window, order.start, order.end);
}

/**
 * Builds the row with a provisional status. Rows with a valid id start as NEVER_USED and are
 * upgraded to USED once Sentry returns logs for them.
 */
function toRow(contactId: string, orders: SubscriptionOrder[], contact: WixContact | undefined, period: Period): SubscriberUsageRow {
  const latestEnd = Math.max(...orders.map((o) => o.end?.getTime() ?? Infinity));
  const id = contact ? iqOptionIdOf(contact) : { value: "", status: "MISSING" as const };
  const iqOptionId = id.value;

  let status: UsageStatus = "NEVER_USED";
  if (!contact) status = "CONTACT_NOT_FOUND";
  else if (id.status === "MISSING") status = "NO_IQ_OPTION_ID";
  else if (id.status === "INVALID") status = "INVALID_IQ_OPTION_ID";

  const days = period.days.map((day) => ({
    day: day.key,
    subscribed: orders.some((o) => overlaps(day.window, o.start, o.end)),
    logCount: 0,
  }));

  return {
    contactId,
    firstName: contact?.info?.name?.first ?? "",
    lastName: contact?.info?.name?.last ?? "",
    email: contact?.primaryInfo?.email ?? "",
    phone: contact?.primaryInfo?.phone ?? "",
    iqOptionId,
    plans: uniq(orders.map((o) => o.order.planName ?? "")).filter(Boolean),
    planTypes: uniq(orders.map((o) => planTypeOf(o.order))),
    subscriptionStart: new Date(Math.min(...orders.map((o) => o.start.getTime()))),
    subscriptionEnd: Number.isFinite(latestEnd) ? new Date(latestEnd) : null,
    status,
    daysSubscribed: days.filter((d) => d.subscribed).length,
    daysUsed: 0,
    totalLogs: 0,
    days,
    pnl: null,
  };
}

/**
 * Status order first. Within a status: most days used, then most logs (for USED),
 * then the subscription that ends soonest, then name.
 */
function compareRows(a: SubscriberUsageRow, b: SubscriberUsageRow): number {
  const end = (r: SubscriberUsageRow) => r.subscriptionEnd?.getTime() ?? Infinity;
  return (
    USAGE_STATUSES.indexOf(a.status) - USAGE_STATUSES.indexOf(b.status) ||
    b.daysUsed - a.daysUsed ||
    b.totalLogs - a.totalLogs ||
    end(a) - end(b) ||
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
  );
}
