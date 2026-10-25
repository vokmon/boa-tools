import { describe, expect, test } from "bun:test";
import { UserReport, type UserReportDependencies } from "@/tools/user-report/UserReport";
import { currentSubscription } from "@/tools/user-report/currentSubscription";
import { extractEmails, parseEmailList } from "@/tools/user-report/emails";
import { csvColumns } from "@/tools/user-report/csvColumns";
import { formatUserReport } from "@/tools/user-report/printReport";
import { parseDate, parseProjects } from "@/tools/shared/commonOptions";
import type { WixContact, WixOrder } from "@/clients/wix/types";
import type { LogRow, LogSearchOptions } from "@/clients/sentry/LogSearchService";
import { toSubscriptionOrder } from "@/domain/subscriptions";
import { buildPeriod } from "@/lib/date";
import { toCsv } from "@/lib/csv/CsvWriter";

const now = new Date("2026-10-21T05:00:00Z");
const period = buildPeriod("18/10/2026", "21/10/2026", "Asia/Bangkok");

describe("emails", () => {
  test("extracts, lower-cases and de-duplicates addresses from any text", () => {
    expect(extractEmails("A@X.com, b@y.co\nname,c@z.org;a@x.com")).toEqual(["a@x.com", "b@y.co", "c@z.org"]);
    expect(() => parseEmailList("nothing here")).toThrow("no email address found");
  });
});

describe("shared options", () => {
  test("parseDate normalises and validates", () => {
    expect(parseDate("1/9/2026")).toBe("01/09/2026");
    expect(() => parseDate("31/02/2026")).toThrow();
  });

  test("parseProjects accepts all or known slugs", () => {
    const available = [{ id: "1", slug: "bot-boa" }, { id: "2", slug: "iq-signal" }] as unknown as Parameters<typeof parseProjects>[1];
    expect(parseProjects("all", available)).toHaveLength(2);
    expect(parseProjects("iq-signal", available).map((p) => p.slug)).toEqual(["iq-signal"]);
    expect(() => parseProjects("nope", available)).toThrow("unknown project(s): nope");
  });
});

function order(id: string, contactId: string, status: string, start: string, end: string | null, price = "0", planName = "Trial"): WixOrder {
  return { _id: id, buyer: { contactId }, status: status as WixOrder["status"], startDate: new Date(start), endDate: end ? new Date(end) : null, planPrice: price, planName };
}

describe("currentSubscription", () => {
  const subs = (...orders: WixOrder[]) => orders.map((o) => toSubscriptionOrder(o)!);

  test("prefers an active plan and counts days left", () => {
    const s = currentSubscription(
      subs(order("1", "c", "ENDED", "2026-09-01T00:00:00Z", "2026-09-04T00:00:00Z"), order("2", "c", "ACTIVE", "2026-10-17T17:00:00Z", "2026-10-25T16:59:59Z", "2990", "Bot 1 Month")),
      now,
    );
    expect(s).toMatchObject({ plan: "Bot 1 Month", planType: "paid", state: "ACTIVE", daysLeft: 5, otherPlans: 1 });
  });

  test("falls back to upcoming, then the most recently ended", () => {
    expect(currentSubscription(subs(order("1", "c", "PENDING", "2026-11-01T00:00:00Z", null)), now)?.state).toBe("UPCOMING");
    const ended = currentSubscription(
      subs(order("1", "c", "ENDED", "2026-08-01T00:00:00Z", "2026-08-04T00:00:00Z"), order("2", "c", "CANCELED", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")),
      now,
    );
    expect(ended).toMatchObject({ state: "CANCELED", daysLeft: null });
    expect(currentSubscription([], now)).toBeNull();
  });
});

describe("UserReport", () => {
  const contact = (id: string, email: string, iq?: string): WixContact => ({
    _id: id,
    info: { name: { first: `F${id}`, last: `L${id}` }, extendedFields: { items: iq === undefined ? {} : { "custom.iq-option": iq } } },
    primaryInfo: { email, phone: `08-${id}` },
  });
  const contacts = new Map([
    ["active@x.test", [contact("a", "active@x.test", "111")]],
    ["noid@x.test", [contact("n", "noid@x.test")]],
  ]);
  const orders = [order("o1", "a", "ACTIVE", "2026-10-17T17:00:00Z", "2026-10-25T16:59:59Z"), order("o2", "n", "ACTIVE", "2026-10-17T17:00:00Z", null)];

  const ts = "2026-10-19T03:00:00+00:00";
  /** Fake Sentry: answers by what the query looks for. */
  function logsFor(query: string): LogRow[] {
    if (query.includes("Order placed successfully") && query.includes("order:*noid@x.test*")) {
      return [{ message: "Order placed successfully (system) (9) A - Amount: 1.00 - user_iq: 222", timestamp: ts }];
    }
    if (query.includes("Order placed successfully") && query.includes("111")) {
      return [
        { message: "Order placed successfully (system) (1) A - Amount: 100.00 - user_iq: 111", order: '{"balanceType":"real","balanceCurrency":"THB"}', timestamp: ts },
        // Placed by hand just before the period: tells where position 2 came from, but is not counted.
        { message: "Order placed successfully (manual) (2) A - Amount: 100.00 - user_iq: 111", order: '{"balanceType":"real","balanceCurrency":"THB"}', timestamp: "2026-10-17T16:30:00+00:00" },
      ];
    }
    if (query.includes("Position closed") && query.includes("111")) {
      // Order 3 has no order log: placed directly in IQ Option.
      return [
        { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB","amount":1085}', timestamp: ts },
        { message: "Position closed (-100.00) - order (2) - user_iq: 111", balance: '{"type":"real","currency":"THB","amount":985}', timestamp: "2026-10-18T03:00:00+00:00" },
        { message: "Position closed (50.00) - order (3) - user_iq: 111", balance: '{"type":"real","currency":"THB","amount":935}', timestamp: "2026-10-18T02:00:00+00:00" },
      ];
    }
    if (query.includes("validation") && query.includes("active@x.test")) return [{ timestamp: ts }, { timestamp: "2026-10-18T03:00:00+00:00" }];
    if (query === "message:*111*") return [{ message: "x - user_iq: 111", timestamp: ts }];
    return [];
  }

  const queries: string[] = [];
  const deps: UserReportDependencies = {
    orders: { listOrders: async () => orders },
    contacts: { getContactsByEmails: async (emails) => new Map([...emails].flatMap((e): [string, WixContact[]][] => (contacts.has(e) ? [[e, contacts.get(e)!]] : []))) },
    usage: {
      countMessagesContaining: async (text) =>
        text === "111" ? [{ start: new Date("2026-10-18T03:00:00Z"), count: 3 }, { start: new Date("2026-10-19T03:00:00Z"), count: 1 }] : [],
    },
    logs: {
      iterateLogs: async function* (o: LogSearchOptions) {
        queries.push(o.query);
        yield* logsFor(o.query);
      },
      findLatest: async (o) => {
        queries.push(o.query);
        return logsFor(o.query)[0] ?? null;
      },
    },
  };

  const build = () =>
    new UserReport(deps).build({ emails: ["active@x.test", "noid@x.test", "ghost@x.test"], period, sentryProjectIds: ["1"], now });

  test("found user: subscription, activity, trading and blocked attempts", async () => {
    const [active] = await build();
    expect(active).toMatchObject({
      wixMatch: "FOUND",
      firstName: "Fa",
      phone: "08-a",
      iqOptionId: "111",
      iqOptionIdSource: "wix",
      activeDays: 2,
      periodDays: 4,
      lastSeen: new Date(ts),
      validationFailures: 2,
      lastValidationFailure: new Date(ts),
    });
    expect(active!.subscription).toMatchObject({ state: "ACTIVE", daysLeft: 5 });
    expect(active!.accounts).toEqual([
      {
        account: "real", currency: "THB", orders: 1, botOrders: 1, manualOrders: 0, stake: 100, closed: 3, wins: 2, losses: 1, winRate: 2 / 3, pnl: 35, latestBalance: 1085,
        bySource: {
          system: { trades: 1, wins: 1, losses: 0, pnl: 85 },
          manual: { trades: 1, wins: 0, losses: 1, pnl: -100 },
          outside: { trades: 1, wins: 1, losses: 0, pnl: 50 },
        },
      },
    ]);
  });

  test("empty Wix field: the id comes from the person's order logs", async () => {
    const [, noid] = await build();
    expect(noid).toMatchObject({ iqOptionId: "222", iqOptionIdSource: "sentry", iqOptionIdNote: "Wix field is empty" });
  });

  test("email not in Wix is reported, not dropped", async () => {
    const [, , ghost] = await build();
    expect(ghost).toMatchObject({ wixMatch: "NOT_IN_WIX", subscription: null, iqOptionIdSource: "none", accounts: [] });
  });

  test("terminal and CSV output", async () => {
    const rows = await build();
    const text = formatUserReport(rows, period);
    expect(text).toContain("active@x.test   Fa La   IQ 111   08-a");
    expect(text).toMatch(/Subscription\s+Trial \(trial\), ACTIVE, ends 25\/10\/2026 \(5 days left\)/);
    expect(text).toMatch(/Real \(THB\)\s+1 orders \(1 bot, 0 manual\), stake 100\.00, 3 closed, win rate 67%, P\/L \+35\.00, balance 1,085\.00/);
    expect(text).toMatch(
      /\s+by source: system 1 closed, win rate 100%, P\/L \+85\.00; manual 1 closed, win rate 0%, P\/L -100\.00; outside 1 closed, win rate 100%, P\/L \+50\.00/,
    );
    expect(text).toMatch(/Blocked\s+2 attempts without a valid subscription, last 19\/10\/2026/);
    expect(text).toContain("IQ 222 (found in Sentry logs)");
    expect(text).toMatch(/Wix\s+no contact with this email/);

    const lines = toCsv(rows, csvColumns("Asia/Bangkok")).trim().split("\r\n");
    expect(lines[0]).toBe(
      "email,first_name,last_name,phone,iq_option_id,plan,plan_type,subscription_status,subscription_end,last_seen," +
        "real_currency,real_orders,real_bot_orders,real_manual_orders,real_pnl,real_balance," +
        "real_system_closed,real_system_win_rate,real_system_pnl,real_manual_closed,real_manual_win_rate,real_manual_pnl," +
        "real_outside_closed,real_outside_win_rate,real_outside_pnl," +
        "demo_currency,demo_orders,demo_bot_orders,demo_manual_orders,demo_pnl,demo_balance," +
        "demo_system_closed,demo_system_win_rate,demo_system_pnl,demo_manual_closed,demo_manual_win_rate,demo_manual_pnl," +
        "demo_outside_closed,demo_outside_win_rate,demo_outside_pnl," +
        "validation_failures,last_validation_failure",
    );
    expect(lines[1]).toContain(",THB,1,1,0,35,1085,1,100,85,1,0,-100,1,100,50,,0,0,0,0,,0,0,0,0,0,0,0,0,0,2,");
    expect(lines[3]).toStartWith("ghost@x.test,,,,,,,NOT_IN_WIX,");
  });
});
