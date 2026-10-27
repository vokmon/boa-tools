import { SENTRY_CONCURRENCY, SENTRY_ENVIRONMENT } from "@/config/constants";
import type { ContactsService } from "@/clients/wix/ContactsService";
import type { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import type { LogSearchService } from "@/clients/sentry/LogSearchService";
import { VALIDATION_FAILED_QUERY } from "@/domain/appLogs";
import { currentSubscription, hasValidSubscription } from "@/domain/currentSubscription";
import { iqOptionIdOf, toSubscriptionOrder } from "@/domain/subscriptions";
import { groupBy } from "@/lib/collections";
import { mapWithConcurrency } from "@/lib/concurrency";
import { dayKeyOf, type Period } from "@/lib/date";
import { logger } from "@/lib/logger";
import { readPersonPnl } from "@/tools/shared/tradeLogs";
import type { FollowUpReportResult, FollowUpRow } from "./types";

export interface FollowUpReportDependencies {
  orders: Pick<PricingPlanOrdersService, "listOrders">;
  contacts: Pick<ContactsService, "getContactsByEmails">;
  logs: Pick<LogSearchService, "iterateLogs">;
}

export interface FollowUpReportOptions {
  period: Period;
  sentryProjectIds: string[];
  /** Sum profit/loss of each person's closed trades in the period, split by source. */
  includePnl?: boolean;
  now?: Date;
}

interface Attempts {
  count: number;
  days: Set<string>;
  last: Date;
}

/** People with a Wix account who tried to sign in during the period and still have no valid subscription. */
export class FollowUpReport {
  constructor(private readonly deps: FollowUpReportDependencies) {}

  async build(options: FollowUpReportOptions): Promise<FollowUpReportResult> {
    if (options.sentryProjectIds.length === 0) throw new Error("Select at least one Sentry project");
    const attempts = await this.failedAttempts(options);
    logger.info(`Sentry: ${attempts.size} people failed to sign in`);
    if (attempts.size === 0) return { rows: [], failedPeople: 0, subscribedSince: 0 };

    const contactsByEmail = await this.deps.contacts.getContactsByEmails(attempts.keys());
    const orders = (await this.deps.orders.listOrders()).flatMap((o) => toSubscriptionOrder(o) ?? []);
    const ordersByContact = groupBy(orders, (o) => o.contactId);
    logger.info(`Wix: ${contactsByEmail.size} of ${attempts.size} emails found`);

    const now = options.now ?? new Date();
    const rows: FollowUpRow[] = [];
    let subscribedSince = 0;
    for (const [email, a] of attempts) {
      const contacts = contactsByEmail.get(email) ?? [];
      // Orders from every contact with this email, as one person can have several.
      const personOrders = contacts.flatMap((c) => (c._id ? (ordersByContact.get(c._id) ?? []) : []));
      if (hasValidSubscription(personOrders, now)) {
        subscribedSince++;
        continue;
      }
      // With several contacts, the details come from the first one that has a name.
      const main = contacts.find((c) => c.info?.name?.first || c.info?.name?.last) ?? contacts[0];
      rows.push({
        email,
        inWix: contacts.length > 0,
        firstName: main?.info?.name?.first ?? "",
        lastName: main?.info?.name?.last ?? "",
        phone: main?.primaryInfo?.phone ?? "",
        iqOptionId: contacts.map(iqOptionIdOf).find((id) => id.status === "OK")?.value ?? "",
        attempts: a.count,
        attemptDays: a.days.size,
        lastAttempt: a.last,
        lastPlan: currentSubscription(personOrders, now),
        pnl: null,
      });
    }
    rows.sort((x, y) => y.lastAttempt.getTime() - x.lastAttempt.getTime() || x.email.localeCompare(y.email));
    if (options.includePnl) await this.addProfitAndLoss(rows, options);
    return { rows, failedPeople: attempts.size, subscribedSince };
  }

  /** Searched per person: the list is short, so this is much faster than reading every trade log. */
  private async addProfitAndLoss(rows: FollowUpRow[], options: FollowUpReportOptions): Promise<void> {
    const withId = rows.filter((r) => r.iqOptionId);
    logger.info(`Sentry: reading closed trades of ${withId.length} people`);
    await mapWithConcurrency(withId, SENTRY_CONCURRENCY, async (r) => {
      r.pnl = await readPersonPnl(this.deps.logs, { window: options.period.window, projectIds: options.sentryProjectIds, iqOptionId: r.iqOptionId });
    });
  }

  /** "⛔ Subscription validation failed for: <email>" logs, grouped by email. */
  private async failedAttempts(options: FollowUpReportOptions): Promise<Map<string, Attempts>> {
    const byEmail = new Map<string, Attempts>();
    for await (const row of this.deps.logs.iterateLogs({
      window: options.period.window,
      projectIds: options.sentryProjectIds,
      environment: SENTRY_ENVIRONMENT,
      query: VALIDATION_FAILED_QUERY,
      // Sentry masks the email in the message but keeps it in the first parameter.
      fields: ["message.parameter.0", "timestamp"],
    })) {
      const email = String(row["message.parameter.0"] ?? "").trim().toLowerCase();
      const at = new Date(String(row.timestamp ?? ""));
      if (!email.includes("@") || Number.isNaN(at.getTime())) continue;
      const a = byEmail.get(email) ?? { count: 0, days: new Set<string>(), last: at };
      byEmail.set(email, a);
      a.count++;
      a.days.add(dayKeyOf(at, options.period.timeZone));
      if (at > a.last) a.last = at;
    }
    return byEmail;
  }
}
