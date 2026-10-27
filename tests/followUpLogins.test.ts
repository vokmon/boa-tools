import { describe, expect, test } from "bun:test";
import { FollowUpReport, type FollowUpReportDependencies } from "@/tools/follow-up-logins/FollowUpReport";
import { csvColumns } from "@/tools/follow-up-logins/csvColumns";
import { formatFollowUpReport } from "@/tools/follow-up-logins/printReport";
import { hasValidSubscription } from "@/domain/currentSubscription";
import { toSubscriptionOrder } from "@/domain/subscriptions";
import type { WixContact, WixOrder } from "@/clients/wix/types";
import type { LogRow, LogSearchOptions } from "@/clients/sentry/LogSearchService";
import { buildPeriod } from "@/lib/date";
import { toCsv } from "@/lib/csv/CsvWriter";

const now = new Date("2026-10-27T05:00:00Z");
const period = buildPeriod("20/10/2026", "27/10/2026", "Asia/Bangkok");

function order(id: string, contactId: string, status: string, start: string, end: string | null, price = "0", planName = "Trial"): WixOrder {
  return { _id: id, buyer: { contactId }, status: status as WixOrder["status"], startDate: new Date(start), endDate: end ? new Date(end) : null, planPrice: price, planName };
}
function contact(id: string, email: string, first = `F${id}`, iq?: string): WixContact {
  const items = iq === undefined ? {} : { "custom.iq-option": iq };
  return { _id: id, info: { name: { first, last: `L${id}` }, extendedFields: { items } }, primaryInfo: { email, phone: `08-${id}` } };
}

const contacts = new Map<string, WixContact[]>([
  ["expired@x.test", [contact("e", "expired@x.test", "Fe", "111")]],
  ["renewed@x.test", [contact("r", "renewed@x.test")]],
  ["pending@x.test", [contact("p", "pending@x.test")]],
  ["draft@x.test", [contact("d", "draft@x.test", "Fd", "not-a-number")]],
  ["lapsed@x.test", [contact("l", "lapsed@x.test")]],
  // Two contacts share this email; the second one bought a plan.
  ["twice@x.test", [contact("t1", "twice@x.test", ""), contact("t2", "twice@x.test")]],
]);
const orders = [
  order("o1", "e", "ENDED", "2026-10-13T17:00:00Z", "2026-10-20T16:59:59Z"),
  order("o2", "r", "ENDED", "2026-10-13T17:00:00Z", "2026-10-20T16:59:59Z"),
  order("o3", "r", "ACTIVE", "2026-10-25T17:00:00Z", "2026-11-25T16:59:59Z", "2990", "Bot 1 Month"),
  order("o4", "p", "PENDING", "2026-11-01T00:00:00Z", null, "2990", "Bot 1 Month"),
  order("o5", "d", "DRAFT", "2026-11-01T00:00:00Z", null, "2990", "Bot 1 Month"),
  // Still marked ACTIVE in Wix but already past its end date.
  order("o6", "l", "ACTIVE", "2026-09-01T00:00:00Z", "2026-10-22T16:59:59Z", "2990", "Bot 1 Month"),
  order("o7", "t2", "ACTIVE", "2026-10-25T17:00:00Z", null, "2990", "Bot 1 Month"),
];

const attempt = (email: string, timestamp: string): LogRow => ({ "message.parameter.0": email, timestamp });
const logs: LogRow[] = [
  // 18:00 UTC is the next day in Bangkok, so expired@ tried on 3 local days: 21/10, 22/10 and 23/10
  attempt("Expired@X.test", "2026-10-21T03:00:00+00:00"),
  attempt("expired@x.test", "2026-10-21T18:00:00+00:00"),
  attempt("expired@x.test", "2026-10-23T03:00:00+00:00"),
  attempt("renewed@x.test", "2026-10-22T03:00:00+00:00"),
  attempt("pending@x.test", "2026-10-22T03:00:00+00:00"),
  attempt("draft@x.test", "2026-10-24T03:00:00+00:00"),
  attempt("lapsed@x.test", "2026-10-25T03:00:00+00:00"),
  attempt("twice@x.test", "2026-10-22T03:00:00+00:00"),
  attempt("ghost@x.test", "2026-10-20T03:00:00+00:00"),
  attempt("[email]", "2026-10-20T03:00:00+00:00"),
];

// Trades of expired@ (IQ 111): a bot win logged twice, a manual loss whose order was placed just
// before the period, and a demo trade placed outside the app. 1119 contains "111" but is someone else.
const closedLogs: LogRow[] = [
  { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-21T03:00:00+00:00" },
  { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-21T03:00:01+00:00" },
  { message: "Position closed (-100.00) - order (2) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-19T17:05:00+00:00" },
  { message: "Position closed (1.50) - order (3) - user_iq: 111", balance: '{"type":"demo","currency":"USD"}', timestamp: "2026-10-22T03:00:00+00:00" },
  { message: "Position closed (50.00) - order (9) - user_iq: 1119", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-22T03:00:00+00:00" },
];
const orderLogs: LogRow[] = [
  { message: "Order placed successfully (system) (1) 1/A - Amount: 100.00 - user_iq: 111", order: "{}", timestamp: "2026-10-21T02:59:00+00:00" },
  { message: "Order placed successfully (manual) (2) 1/A - Amount: 100.00 - user_iq: 111", order: "{}", timestamp: "2026-10-19T16:30:00+00:00" },
];
const result = (trades: number, wins: number, losses: number, pnl: number) => ({ trades, wins, losses, pnl });
const none = result(0, 0, 0, 0);

const searches: LogSearchOptions[] = [];
const deps: FollowUpReportDependencies = {
  orders: { listOrders: async () => orders },
  contacts: { getContactsByEmails: async (emails) => new Map([...emails].flatMap((e): [string, WixContact[]][] => (contacts.has(e) ? [[e, contacts.get(e)!]] : []))) },
  logs: {
    iterateLogs: async function* (o: LogSearchOptions) {
      searches.push(o);
      if (o.query.includes("Position closed")) yield* closedLogs;
      else if (o.query.includes("Order placed")) yield* orderLogs;
      else yield* logs;
    },
  },
};
const build = (includePnl = false) => new FollowUpReport(deps).build({ period, sentryProjectIds: ["1"], includePnl, now });

describe("hasValidSubscription", () => {
  const subs = (...o: WixOrder[]) => o.map((x) => toSubscriptionOrder(x)!);

  test("active and not ended, or paid and starting later", () => {
    expect(hasValidSubscription(subs(order("1", "c", "ACTIVE", "2026-10-01T00:00:00Z", null)), now)).toBe(true);
    expect(hasValidSubscription(subs(order("1", "c", "PENDING", "2026-11-01T00:00:00Z", null)), now)).toBe(true);
    expect(hasValidSubscription(subs(order("1", "c", "ACTIVE", "2026-10-01T00:00:00Z", "2026-10-26T00:00:00Z")), now)).toBe(false);
    expect(hasValidSubscription(subs(order("1", "c", "DRAFT", "2026-11-01T00:00:00Z", null)), now)).toBe(false);
    expect(hasValidSubscription([], now)).toBe(false);
  });
});

describe("FollowUpReport", () => {
  test("lists people still without a valid subscription, latest attempt first", async () => {
    const result = await build();
    expect(searches[0]!.query).toContain("Subscription*validation*failed");
    expect(result.failedPeople).toBe(7);
    expect(result.subscribedSince).toBe(3);
    expect(result.rows.map((r) => r.email)).toEqual(["lapsed@x.test", "draft@x.test", "expired@x.test", "ghost@x.test"]);
  });

  test("counts attempts and local days per email, case-insensitive", async () => {
    const expired = (await build()).rows.find((r) => r.email === "expired@x.test")!;
    expect(expired).toMatchObject({
      inWix: true,
      firstName: "Fe",
      lastName: "Le",
      phone: "08-e",
      iqOptionId: "111",
      attempts: 3,
      attemptDays: 3,
      lastAttempt: new Date("2026-10-23T03:00:00Z"),
    });
    expect(expired.lastPlan).toMatchObject({ plan: "Trial", planType: "trial", state: "ENDED" });
  });

  test("an email no longer in Wix is kept, without details", async () => {
    const ghost = (await build()).rows.find((r) => r.email === "ghost@x.test")!;
    expect(ghost).toMatchObject({ inWix: false, firstName: "", phone: "", iqOptionId: "", lastPlan: null });
  });

  test("profit/loss per person, searched by IQ Option id, only when requested", async () => {
    searches.length = 0;
    const rows = (await build(true)).rows;
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(byEmail["expired@x.test"]!.pnl).toEqual([
      { account: "real", currency: "THB", ...result(2, 1, 1, -15), bySource: { system: result(1, 1, 0, 85), manual: result(1, 0, 1, -100), outside: none } },
      { account: "demo", currency: "USD", ...result(1, 1, 0, 1.5), bySource: { system: none, manual: none, outside: result(1, 1, 0, 1.5) } },
    ]);
    // An invalid Wix field or no contact: no id, so nothing to search.
    expect(byEmail["draft@x.test"]!.pnl).toBeNull();
    expect(byEmail["ghost@x.test"]!.pnl).toBeNull();
    expect(byEmail["lapsed@x.test"]!.pnl).toBeNull();
    const tradeSearches = searches.filter((s) => !s.query.includes("validation"));
    expect(tradeSearches.map((s) => s.query.endsWith("message:*111*"))).toEqual([true, true]);
    expect(tradeSearches.find((s) => s.query.includes("Order placed"))!.window.start).toEqual(new Date(period.window.start.getTime() - 3_600_000));
    expect((await build()).rows.every((r) => r.pnl === null)).toBe(true);
  });

  test("requires at least one Sentry project", async () => {
    expect(new FollowUpReport(deps).build({ period, sentryProjectIds: [], now })).rejects.toThrow();
  });
});

describe("output", () => {
  test("terminal summary and table; CSV in the same order", async () => {
    const result = await build();
    const text = formatFollowUpReport(result, period);
    expect(text).toContain("7 people failed to sign in; 3 subscribed since and are left out.");
    expect(text).toContain("TO FOLLOW UP (4)  latest attempt first");
    expect(text).toMatch(/Fe\s+Le\s+expired@x\.test\s+08-e\s+3 attempts\s+last 23\/10\/2026 10:00\s+Trial \(trial\), ENDED 20\/10\/2026/);
    expect(text).toMatch(/Fd\s+Ld\s+draft@x\.test\s+08-d\s+1 attempt\s+last 24\/10\/2026 10:00\s+Bot 1 Month \(paid\), UPCOMING starts 01\/11\/2026/);
    expect(text).toMatch(/-\s+-\s+ghost@x\.test\s+-\s+1 attempt\s+last 20\/10\/2026 10:00\s+not in Wix/);

    const lines = toCsv(result.rows, csvColumns("Asia/Bangkok")).trim().split("\r\n");
    expect(lines[0]).toBe("first_name,last_name,email,phone,iq_option_id,attempts,attempt_days,last_attempt,last_plan,plan_type,plan_status,plan_end");
    expect(lines[3]).toBe("Fe,Le,expired@x.test,08-e,111,3,3,23/10/2026 10:00,Trial,trial,ENDED,20/10/2026");
    expect(lines[4]).toBe(",,ghost@x.test,,,1,1,20/10/2026 10:00,NOT_IN_WIX,,,");
  });

  test("with profit/loss: the same columns as subscriber-usage, blank without an IQ Option id", async () => {
    const result = await build(true);
    const text = formatFollowUpReport(result, period, true);
    expect(text).toMatch(/expired@x\.test.*ENDED 20\/10\/2026\s+3 trades\s+real -15\.00 THB \(system \+85\.00, manual -100\.00\), demo \+1\.50 USD \(outside \+1\.50\)/);
    expect(text).toMatch(/ghost@x\.test.*not in Wix\s+no IQ Option id/);

    const lines = toCsv(result.rows, csvColumns("Asia/Bangkok", result.rows)).trim().split("\r\n");
    expect(lines[0]).toEndWith(
      ",plan_end,trades,pnl_real (THB),pnl_real_system (THB),pnl_real_manual (THB),pnl_real_outside (THB)," +
        "pnl_demo (USD),pnl_demo_system (USD),pnl_demo_manual (USD),pnl_demo_outside (USD)",
    );
    expect(lines[3]).toEndWith(",20/10/2026,3,-15,85,-100,0,1.5,0,0,1.5");
    expect(lines[4]).toEndWith(",NOT_IN_WIX,,,,,,,,,,,,");
  });

  test("nobody to follow up", () => {
    expect(formatFollowUpReport({ rows: [], failedPeople: 1, subscribedSince: 1 }, period)).toContain("Nobody to follow up.");
  });
});
