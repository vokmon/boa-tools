import { describe, expect, test } from "bun:test";
import { SubscriberUsageReport, type ReportDependencies } from "@/tools/subscriber-usage/SubscriberUsageReport";
import { csvColumns } from "@/tools/subscriber-usage/csvColumns";
import type { WixContact, WixOrder } from "@/clients/wix/types";
import type { TimeBucket } from "@/clients/sentry/MessageTimeseriesService";
import type { LogRow } from "@/clients/sentry/LogSearchService";
import type { PlanFilter, SubscriberUsageRow, SubscriptionMatch } from "@/tools/subscriber-usage/types";
import { buildPeriod } from "@/lib/date";
import { toCsv } from "@/lib/csv/CsvWriter";
import { formatReport } from "@/tools/subscriber-usage/printReport";

// 18-20/10/2026 in Bangkok = 17/10 17:00 UTC to 20/10 16:59:59 UTC
const period = buildPeriod("18/10/2026", "20/10/2026", "Asia/Bangkok");

function order(id: string, contactId: string, price: string, start: string, end: string | null): WixOrder {
  return {
    _id: id,
    planName: price === "0" ? "Trial" : "Bot 1 Month",
    status: "ACTIVE",
    startDate: new Date(start),
    endDate: end ? new Date(end) : null,
    buyer: { contactId },
    planPrice: price,
  };
}
function contact(id: string, iq?: string): WixContact {
  return {
    _id: id,
    info: { name: { first: `F${id}`, last: `L${id}` }, extendedFields: { items: iq === undefined ? {} : { "custom.iq-option": iq } } },
    primaryInfo: { email: `${id}@x.test`, phone: `08-${id}` },
  };
}

const orders: WixOrder[] = [
  // trial for the whole period, then paid from the 19th (Bangkok)
  order("o1", "used", "0", "2026-10-17T17:00:00Z", "2026-10-20T17:00:00Z"),
  order("o7", "used", "2990", "2026-10-18T17:00:00Z", null),
  // subscribed only on the 18th and 19th (ends 19/10 12:00 Bangkok)
  order("o2", "idle", "2990", "2026-10-01T00:00:00Z", "2026-10-19T05:00:00Z"),
  order("o3", "noid", "0", "2026-10-18T00:00:00Z", null),
  order("o4", "bad", "0", "2026-10-18T00:00:00Z", null),
  order("o5", "gone", "0", "2026-10-18T00:00:00Z", null),
  // ended one millisecond before the period
  order("o6", "outside", "0", "2026-09-01T00:00:00Z", "2026-10-17T16:59:59.999Z"),
];
const contacts = new Map(
  [contact("used", "111"), contact("idle", "222"), contact("noid"), contact("bad", "someone"), contact("outside", "333")].map((c) => [c._id!, c]),
);

// 111: 2 logs at 23:30 Bangkok on the 18th, 5 logs at 00:30 Bangkok on the 20th
const buckets: Record<string, TimeBucket[]> = {
  "111": [
    { start: new Date("2026-10-18T16:00:00Z"), count: 2 },
    { start: new Date("2026-10-19T17:00:00Z"), count: 5 },
  ],
};

// Closed positions for 111: two real trades on 18/10 (one logged twice), one demo trade on 20/10,
// and one on 21/10 which is outside the period window the fake ignores (the real API filters it).
const closedLogs: LogRow[] = [
  { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-18T03:00:00+00:00" },
  { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-18T03:00:01+00:00" },
  { message: "Position closed (-100.00) - order (2, 3) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-18T04:00:00+00:00" },
  { message: "Position closed (1.73) - order (4) - user_iq: 111", balance: '{"type":"demo","currency":"USD"}', timestamp: "2026-10-19T18:00:00+00:00" },
  { message: "Position closed (50.00) - order (5) - user_iq: 999", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-18T03:00:00+00:00" },
];

function deps(searched: string[] = []): ReportDependencies {
  return {
    orders: { listOrders: async () => orders },
    contacts: {
      getContactsByIds: async (ids: Iterable<string>) =>
        new Map([...ids].flatMap((id): [string, WixContact][] => (contacts.has(id) ? [[id, contacts.get(id)!]] : []))),
    },
    usage: {
      countMessagesContaining: async (id: string) => {
        searched.push(id);
        return buckets[id] ?? [];
      },
    },
    logs: {
      iterateLogs: async function* () {
        yield* closedLogs;
      },
    },
  };
}

const run = (planFilter: PlanFilter, searched?: string[], match: SubscriptionMatch = "active", includePnl = false) =>
  new SubscriberUsageReport(deps(searched)).build({ period, planFilter, match, includePnl, sentryProjectIds: ["1"] });
const byId = (rows: SubscriberUsageRow[]) => Object.fromEntries(rows.map((r) => [r.contactId, r]));

describe("SubscriberUsageReport", () => {
  test("classifies every subscriber in the period, one row per contact", async () => {
    const searched: string[] = [];
    const rows = byId(await run("all", searched));
    expect(Object.keys(rows).sort()).toEqual(["bad", "gone", "idle", "noid", "used"]);
    expect(rows.used!.status).toBe("USED");
    expect(rows.idle!.status).toBe("NEVER_USED");
    expect(rows.noid!.status).toBe("NO_IQ_OPTION_ID");
    expect(rows.bad!.status).toBe("INVALID_IQ_OPTION_ID");
    expect(rows.gone!.status).toBe("CONTACT_NOT_FOUND");
    expect(searched.sort()).toEqual(["111", "222"]);
  });

  test("splits usage into local days and tracks subscribed days", async () => {
    const rows = byId(await run("all"));
    expect(rows.used!.days.map((d) => d.logCount)).toEqual([2, 0, 5]);
    expect(rows.used!.daysUsed).toBe(2);
    expect(rows.used!.totalLogs).toBe(7);
    expect(rows.used!.planTypes.sort()).toEqual(["paid", "trial"]);
    expect(rows.idle!.days.map((d) => d.subscribed)).toEqual([true, true, false]);
    expect(rows.idle!.daysSubscribed).toBe(2);
  });

  test("sorts never used first, then data problems, then used", async () => {
    expect((await run("all")).map((r) => r.status)).toEqual([
      "NEVER_USED",
      "NO_IQ_OPTION_ID",
      "INVALID_IQ_OPTION_ID",
      "CONTACT_NOT_FOUND",
      "USED",
    ]);
  });

  test("started: only subscriptions whose start date is inside the period", async () => {
    // "used" started 18/10 00:00 Bangkok (inside); "idle" started 01/10 (before); o3-o5 start 18/10 07:00 Bangkok
    const ids = (await run("all", undefined, "started")).map((r) => r.contactId).sort();
    expect(ids).toEqual(["bad", "gone", "noid", "used"]);
  });

  test("profit/loss: de-duplicated, real and demo kept apart, only for subscribed people", async () => {
    const rows = byId(await run("all", undefined, "active", true));
    expect(rows.used!.pnl).toEqual([
      { account: "real", currency: "THB", trades: 2, wins: 1, losses: 1, pnl: -15 },
      { account: "demo", currency: "USD", trades: 1, wins: 1, losses: 0, pnl: 1.73 },
    ]);
    expect(rows.idle!.pnl).toEqual([]);
    expect(rows.noid!.pnl).toBeNull();
  });

  test("profit/loss is not computed unless requested", async () => {
    expect(byId(await run("all")).used!.pnl).toBeNull();
  });

  test("usage on days without a matching subscription is ignored", async () => {
    // paid only: "used" is subscribed from 19/10 (Bangkok), so the 18/10 logs and trades do not count
    const rows = byId(await run("paid", undefined, "active", true));
    expect(rows.used!.days.map((d) => d.logCount)).toEqual([0, 0, 5]);
    expect(rows.used!.daysUsed).toBe(1);
    expect(rows.used!.pnl).toEqual([{ account: "demo", currency: "USD", trades: 1, wins: 1, losses: 0, pnl: 1.73 }]);
  });

  test("reads the phone number", async () => {
    expect(byId(await run("all")).used!.phone).toBe("08-used");
  });

  test("filters by plan type", async () => {
    expect((await run("paid")).map((r) => r.contactId).sort()).toEqual(["idle", "used"]);
    expect((await run("trial")).map((r) => r.contactId).sort()).toEqual(["bad", "gone", "noid", "used"]);
  });

  test("skips orders without a contact or start date", async () => {
    const broken = { _id: "x", planPrice: "0", startDate: null, buyer: {} } as WixOrder;
    const d = deps();
    const rows = await new SubscriberUsageReport({ ...d, orders: { listOrders: async () => [...orders, broken] } }).build({
      period,
      planFilter: "all",
      match: "active",
      includePnl: false,
      sentryProjectIds: ["1"],
    });
    expect(rows).toHaveLength(5);
  });

  test("requires at least one Sentry project", async () => {
    expect(new SubscriberUsageReport(deps()).build({ period, planFilter: "all", match: "active", includePnl: false, sentryProjectIds: [] })).rejects.toThrow();
  });
});

describe("csvColumns", () => {
  test("summary columns only, no per-day or log-count columns", async () => {
    const rows = await run("all");
    const lines = toCsv(rows, csvColumns(period, rows)).trim().split("\r\n");
    expect(lines[0]).toBe("status,first_name,last_name,iq_option_id,email,phone,days_used,days_subscribed,used_days,plan,subscription_end");
    const line = (status: string) => lines.find((l) => l.startsWith(`${status},`))!;
    expect(line("USED")).toBe('USED,Fused,Lused,111,used@x.test,08-used,2,3,"18/10, 20/10",Trial | Bot 1 Month,');
    expect(line("NEVER_USED")).toBe("NEVER_USED,Fidle,Lidle,222,idle@x.test,08-idle,0,2,,Bot 1 Month,19/10/2026");
    expect(line("NO_IQ_OPTION_ID")).toBe("NO_IQ_OPTION_ID,Fnoid,Lnoid,,noid@x.test,08-noid,,3,,Trial,");
  });
});

describe("formatReport", () => {
  test("prints never used, cannot check, then used with their days", async () => {
    const text = formatReport(await run("all"), { period, planFilter: "all" });
    const titles = text.split("\n").filter((l) => /^[A-Z]/.test(l));
    expect(titles).toEqual([
      "Subscribers active 18/10/2026 to 20/10/2026 (Asia/Bangkok)",
      "NEVER USED (1)  candidates to switch off",
      "CANNOT CHECK (3)  fix in Wix before deciding",
      "USED (1)  most active first",
    ]);
    expect(text).toMatch(/Fidle\s+Lidle\s+222\s+idle@x\.test\s+08-idle\s+ends 19\/10\/2026/);
    expect(text).toMatch(/Fbad\s+Lbad\s+someone\s+bad@x\.test\s+08-bad\s+IQ Option field is not a number/);
    expect(text).toMatch(/Fused\s+Lused\s+111\s+used@x\.test\s+08-used\s+2\/3 days\s+18\/10, 20\/10/);
  });
});

describe("profit/loss output", () => {
  test("terminal shows trades and totals; CSV gets one pnl column per account", async () => {
    const rows = await run("all", undefined, "active", true);
    const text = formatReport(rows, { period, planFilter: "all", includePnl: true });
    expect(text).toMatch(/3 trades\s+real -15\.00 THB, demo \+1\.73 USD/);
    const lines = toCsv(rows, csvColumns(period, rows)).trim().split("\r\n");
    expect(lines[0]).toContain(",used_days,pnl_real (THB),pnl_demo (USD),plan,");
    expect(lines.find((l) => l.startsWith("USED,"))).toContain('"18/10, 20/10",-15,1.73,');
    expect(lines.find((l) => l.startsWith("NEVER_USED,"))).toContain(",0,0,Bot 1 Month,");
    expect(lines.find((l) => l.startsWith("NO_IQ_OPTION_ID,"))).toContain(",,,Trial,");
  });

  test("an amount in a different currency keeps its currency", () => {
    const row = { status: "USED", pnl: [{ account: "real", currency: "USD", trades: 1, wins: 1, losses: 0, pnl: 2.5 }] } as SubscriberUsageRow;
    const other = { status: "USED", pnl: [{ account: "real", currency: "THB", trades: 1, wins: 1, losses: 0, pnl: 9 }] } as SubscriberUsageRow;
    const third = { ...other };
    const column = csvColumns(period, [row, other, third]).find((c) => c.header.startsWith("pnl_real"))!;
    expect(column.header).toBe("pnl_real (THB)");
    expect(column.value(row)).toBe("2.5 USD");
    expect(column.value(other)).toBe(9);
  });
});
