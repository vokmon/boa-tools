import { SENTRY_DATASETS, SENTRY_ENVIRONMENT } from "@/config/constants";
import type { ContactsService } from "@/clients/wix/ContactsService";
import type { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import type { WixContact } from "@/clients/wix/types";
import type { LogSearchService } from "@/clients/sentry/LogSearchService";
import type { MessageTimeseriesService } from "@/clients/sentry/MessageTimeseriesService";
import { appOpenedText, validationFailedFor } from "@/domain/appLogs";
import { iqOptionIdOf, isValidIqOptionId, toSubscriptionOrder, type SubscriptionOrder } from "@/domain/subscriptions";
import {
  CLOSED_POSITION_FIELDS,
  CLOSED_POSITION_QUERY,
  ORDER_PLACED_FIELDS,
  ORDER_PLACED_QUERY,
  iqOptionIdInMessage,
  parseClosedPosition,
  parsePlacedOrder,
  summarizeAccounts,
  type ClosedPosition,
  type PlacedOrder,
} from "@/domain/trading";
import { groupBy } from "@/lib/collections";
import { mapWithConcurrency } from "@/lib/concurrency";
import { dayKeyOf, type Period } from "@/lib/date";
import { logger } from "@/lib/logger";
import { currentSubscription } from "./currentSubscription";
import type { IqOptionIdSource, UserReportRow, WixMatch } from "./types";

/** People looked up at the same time; each makes several Sentry requests. */
const USER_CONCURRENCY = 3;

export interface UserReportDependencies {
  orders: Pick<PricingPlanOrdersService, "listOrders">;
  contacts: Pick<ContactsService, "getContactsByEmails">;
  usage: Pick<MessageTimeseriesService, "countMessagesContaining">;
  logs: Pick<LogSearchService, "iterateLogs" | "findLatest">;
}

export interface UserReportOptions {
  emails: string[];
  period: Period;
  sentryProjectIds: string[];
  now?: Date;
}

/** Subscription and trading performance for a list of people, looked up by email. */
export class UserReport {
  constructor(private readonly deps: UserReportDependencies) {}

  async build(options: UserReportOptions): Promise<UserReportRow[]> {
    const contactsByEmail = await this.deps.contacts.getContactsByEmails(options.emails);
    const orders = (await this.deps.orders.listOrders()).flatMap((o) => toSubscriptionOrder(o) ?? []);
    const ordersByContact = groupBy(orders, (o) => o.contactId);
    logger.info(`Wix: ${contactsByEmail.size} of ${options.emails.length} emails found`);

    let done = 0;
    return mapWithConcurrency(options.emails, USER_CONCURRENCY, async (email) => {
      const contacts = contactsByEmail.get(email) ?? [];
      const row = await this.buildRow(email, contacts, ordersByContact, options);
      logger.info(`(${++done}/${options.emails.length}) ${email}`);
      return row;
    });
  }

  private async buildRow(
    email: string,
    contacts: WixContact[],
    ordersByContact: Map<string, SubscriptionOrder[]>,
    options: UserReportOptions,
  ): Promise<UserReportRow> {
    const contactOrders = contacts.flatMap((c) => (c._id ? (ordersByContact.get(c._id) ?? []) : []));
    // With several contacts for one email, the details come from the one with the latest order.
    const main = pickMainContact(contacts, ordersByContact);
    const wixMatch: WixMatch = contacts.length === 0 ? "NOT_IN_WIX" : contacts.length > 1 ? "MULTIPLE_CONTACTS" : "FOUND";

    const { iqOptionId, source, note } = await this.resolveIqOptionId(email, contacts, options);
    const sentry = iqOptionId ? await this.sentryActivity(iqOptionId, email, options) : await this.appOpensOnly(email, options);
    const validation = await this.validationFailures(email, options);

    return {
      email,
      wixMatch,
      contactCount: contacts.length,
      firstName: main?.info?.name?.first ?? "",
      lastName: main?.info?.name?.last ?? "",
      phone: main?.primaryInfo?.phone ?? "",
      iqOptionId,
      iqOptionIdSource: source,
      iqOptionIdNote: note,
      subscription: currentSubscription(contactOrders, options.now),
      activeDays: sentry.activeDays,
      periodDays: options.period.days.length,
      lastSeen: sentry.lastSeen,
      accounts: sentry.accounts,
      validationFailures: validation.count,
      lastValidationFailure: validation.last,
    };
  }

  /** The Wix custom field when valid; otherwise the id on the person's order logs (matched by login email). */
  private async resolveIqOptionId(
    email: string,
    contacts: WixContact[],
    options: UserReportOptions,
  ): Promise<{ iqOptionId: string; source: IqOptionIdSource; note: string }> {
    const fromWix = contacts.map(iqOptionIdOf);
    const valid = fromWix.find((id) => id.status === "OK");
    if (valid) return { iqOptionId: valid.value, source: "wix", note: "" };

    const invalid = fromWix.find((id) => id.status === "INVALID");
    const note = contacts.length === 0 ? "" : invalid ? `Wix field is not a number: ${invalid.value}` : "Wix field is empty";
    const latest = await this.deps.logs.findLatest({
      ...this.searchScope(options),
      query: `${ORDER_PLACED_QUERY} order:*${email}*`,
      fields: ["message"],
    });
    const fromLogs = iqOptionIdInMessage(latest?.message);
    if (fromLogs && isValidIqOptionId(fromLogs)) return { iqOptionId: fromLogs, source: "sentry", note };
    return { iqOptionId: "", source: "none", note };
  }

  private async sentryActivity(iqOptionId: string, email: string, options: UserReportOptions) {
    const scope = this.searchScope(options);
    const [orders, positions, idBuckets, openBuckets, latestById, latestOpen] = await Promise.all([
      this.collect(`${ORDER_PLACED_QUERY} message:*${iqOptionId}*`, ORDER_PLACED_FIELDS, parsePlacedOrder, options),
      this.collect(`${CLOSED_POSITION_QUERY} message:*${iqOptionId}*`, CLOSED_POSITION_FIELDS, parseClosedPosition, options),
      this.deps.usage.countMessagesContaining(iqOptionId, { ...scope, datasets: SENTRY_DATASETS }),
      this.deps.usage.countMessagesContaining(appOpenedText(email), { ...scope, datasets: ["logs"] }),
      this.deps.logs.findLatest({ ...scope, query: `message:*${iqOptionId}*`, fields: ["message"] }),
      this.deps.logs.findLatest({ ...scope, query: `message:*${appOpenedText(email)}*`, fields: ["message"] }),
    ]);
    const tz = options.period.timeZone;
    const activeDays = new Set([...idBuckets, ...openBuckets].map((b) => dayKeyOf(b.start, tz)));
    return {
      activeDays: activeDays.size,
      lastSeen: latestOf(latestById?.timestamp, latestOpen?.timestamp),
      accounts: summarizeAccounts(
        orders.filter((o) => o.iqOptionId === iqOptionId),
        positions.filter((p) => p.iqOptionId === iqOptionId),
      ),
    };
  }

  /** Without an IQ Option id only app opens (logged by email) can be found. */
  private async appOpensOnly(email: string, options: UserReportOptions) {
    const scope = this.searchScope(options);
    const [buckets, latest] = await Promise.all([
      this.deps.usage.countMessagesContaining(appOpenedText(email), { ...scope, datasets: ["logs"] }),
      this.deps.logs.findLatest({ ...scope, query: `message:*${appOpenedText(email)}*`, fields: ["message"] }),
    ]);
    return {
      activeDays: new Set(buckets.map((b) => dayKeyOf(b.start, options.period.timeZone))).size,
      lastSeen: latestOf(latest?.timestamp),
      accounts: [],
    };
  }

  private async validationFailures(email: string, options: UserReportOptions) {
    let count = 0;
    let last: Date | null = null;
    for await (const row of this.deps.logs.iterateLogs({
      ...this.searchScope(options),
      query: validationFailedFor(email),
      fields: ["timestamp"],
    })) {
      count++;
      last ??= latestOf(row.timestamp);
    }
    return { count, last };
  }

  private async collect<T extends PlacedOrder | ClosedPosition>(
    query: string,
    fields: readonly string[],
    parse: (row: Record<string, unknown>) => T | null,
    options: UserReportOptions,
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const row of this.deps.logs.iterateLogs({ ...this.searchScope(options), query, fields })) {
      const parsed = parse(row);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  private searchScope(options: UserReportOptions) {
    return { window: options.period.window, projectIds: options.sentryProjectIds, environment: SENTRY_ENVIRONMENT };
  }
}

function pickMainContact(contacts: WixContact[], ordersByContact: Map<string, SubscriptionOrder[]>): WixContact | undefined {
  const latestStart = (c: WixContact) => Math.max(-Infinity, ...(ordersByContact.get(c._id ?? "") ?? []).map((o) => o.start.getTime()));
  return [...contacts].sort((a, b) => latestStart(b) - latestStart(a))[0];
}

function latestOf(...timestamps: unknown[]): Date | null {
  const times = timestamps
    .filter((t) => t !== undefined && t !== null)
    .map((t) => new Date(String(t)).getTime())
    .filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}
