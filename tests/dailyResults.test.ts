import { describe, expect, test } from "bun:test";
import { DailyResults, resultOf, type DailyResultsDependencies } from "@/tools/daily-results/DailyResults";
import { csvColumns } from "@/tools/daily-results/csvColumns";
import { formatDailyResults } from "@/tools/daily-results/printReport";
import type { WixContact } from "@/clients/wix/types";
import type { LogRow, LogSearchOptions } from "@/clients/sentry/LogSearchService";
import { buildPeriod } from "@/lib/date";
import { rangeByUser, type ClosedPosition } from "@/domain/trading";
import { toCsv } from "@/lib/csv/CsvWriter";

const period = buildPeriod("02/11/2026", "02/11/2026", "Asia/Bangkok");
const real = '{"type":"real","currency":"THB"}';
const demo = '{"type":"demo","currency":"USD"}';
const closed = (pnl: string, order: string, id: string, balance = real, timestamp = "2026-11-02T03:00:00+00:00"): LogRow => ({
  message: `Position closed (${pnl}) - order (${order}) - user_iq: ${id}`,
  balance,
  timestamp,
});

const closedLogs: LogRow[] = [
  // 111 wins on real, with the same close logged twice (two browsers)
  closed("85.00", "1", "111"),
  closed("85.00", "1", "111", real, "2026-11-02T03:00:02+00:00"),
  closed("-30.00", "2", "111", real, "2026-11-02T03:05:00+00:00"),
  // 222 loses on real but wins on demo; the result follows real
  closed("-100.00", "3", "222"),
  closed("50.00", "4", "222", demo),
  // 333 only trades on demo and is not in Wix
  closed("-5.00", "5", "333", demo),
];
const orderLogs: LogRow[] = [{ message: "Order placed successfully (system) (1) 1/A - Amount: 100.00 - user_iq: 111", order: "{}", timestamp: "2026-11-02T02:59:00+00:00" }];

function contact(id: string, iq: string): WixContact {
  return { _id: id, info: { name: { first: `F${id}`, last: `L${id}` }, extendedFields: { items: { "custom.iq-option": iq } } }, primaryInfo: { email: `${id}@x.test`, phone: `08-${id}` } };
}
const contacts = new Map([["111", [contact("a", "111")]], ["222", [contact("b", "222")]]]);

const lookedUp: string[][] = [];
const deps: DailyResultsDependencies = {
  contacts: {
    getContactsByCustomField: async (key, values) => {
      expect(key).toBe("custom.iq-option");
      const ids = [...values];
      lookedUp.push(ids);
      return new Map(ids.flatMap((id): [string, WixContact[]][] => (contacts.has(id) ? [[id, contacts.get(id)!]] : [])));
    },
  },
  logs: {
    iterateLogs: async function* (o: LogSearchOptions) {
      if (o.query.includes("Position closed")) yield* closedLogs;
      else if (o.query.includes("Order placed")) yield* orderLogs;
    },
  },
};
const build = () => new DailyResults(deps).build({ period, sentryProjectIds: ["1"] });

describe("DailyResults", () => {
  test("everyone who closed a trade, the biggest real loss first, demo-only last", async () => {
    const rows = await build();
    expect(rows.map((r) => [r.iqOptionId, r.result])).toEqual([
      ["222", "LOSS"],
      ["111", "WIN"],
      ["333", "DEMO ONLY"],
    ]);
    expect(lookedUp.at(-1)!.sort()).toEqual(["111", "222", "333"]);
  });

  test("Wix details, duplicates counted once, sources split", async () => {
    const rows = await build();
    const a = rows.find((r) => r.iqOptionId === "111")!;
    expect(a).toMatchObject({ inWix: true, firstName: "Fa", lastName: "La", email: "a@x.test", phone: "08-a" });
    expect(a.pnl).toMatchObject([{ account: "real", currency: "THB", trades: 2, wins: 1, losses: 1, pnl: 55, bySource: { system: { pnl: 85 }, outside: { pnl: -30 } } }]);
    expect(a.realRange).toEqual({ account: "real", currency: "THB", high: 85, highAt: new Date("2026-11-02T03:00:00Z"), low: 0, lowAt: null });
    expect(rows.find((r) => r.iqOptionId === "333")).toMatchObject({ inWix: false, firstName: "", email: "", realRange: null });
  });

  test("nobody traded: no Wix lookup", async () => {
    const quiet: DailyResultsDependencies = { ...deps, logs: { iterateLogs: async function* () {} } };
    lookedUp.length = 0;
    expect(await new DailyResults(quiet).build({ period, sentryProjectIds: ["1"] })).toEqual([]);
    expect(lookedUp).toHaveLength(0);
  });
});

describe("rangeByUser", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 8, minute));
  const position = (orderKey: string, pnl: number, minute: number, account = "real"): ClosedPosition => ({
    iqOptionId: "1",
    orderKey,
    pnlCents: Math.round(pnl * 100),
    closedAt: at(minute),
    account,
    currency: "THB",
    balanceAfter: null,
  });

  test("high and low of the running total, in closing order, each order once", () => {
    // Up to +600, then a lost martingale round takes it to -161.25; logs arrive newest first
    const positions = [
      position("6", -468.75, 26),
      position("5", -187.5, 25),
      position("4", -75, 24),
      position("3", -30, 23),
      position("2", 575, 10),
      position("2", 575, 10),
      position("1", 25, 5),
      position("d", -999, 1, "demo"),
    ];
    const [realRange, demoRange] = rangeByUser(positions).get("1")!;
    expect(realRange).toEqual({ account: "real", currency: "THB", high: 600, highAt: at(10), low: -161.25, lowAt: at(26) });
    expect(demoRange).toMatchObject({ account: "demo", high: 0, highAt: null, low: -999 });
  });
});

describe("resultOf", () => {
  const total = (account: string, pnl: number) => ({ account, currency: "THB", trades: 1, wins: 0, losses: 0, pnl, bySource: {} as never });
  test("decided by the real account; demo alone is DEMO ONLY", () => {
    expect(resultOf([total("real", 10), total("demo", -50)])).toBe("WIN");
    expect(resultOf([total("real", -10)])).toBe("LOSS");
    expect(resultOf([total("real", 0)])).toBe("EVEN");
    expect(resultOf([total("demo", 50)])).toBe("DEMO ONLY");
  });
});

describe("output", () => {
  test("CSV columns", async () => {
    const rows = await build();
    const [header, first, second, last] = toCsv(rows, csvColumns("Asia/Bangkok", rows)).trim().split("\r\n");
    expect(header).toBe(
      "first_name,last_name,email,phone,iq_option_id,result,trades,wins,losses,pnl_real (THB),pnl_real_system (THB),pnl_real_manual (THB),pnl_real_outside (THB),pnl_demo (USD),pnl_demo_system (USD),pnl_demo_manual (USD),pnl_demo_outside (USD),max_profit_real,max_profit_at,max_loss_real,max_loss_at",
    );
    expect(first).toBe("Fb,Lb,b@x.test,08-b,222,LOSS,2,1,1,-100,0,0,-100,50,0,0,50,0,,-100,02/11/2026 10:00");
    expect(second).toEndWith(",85,02/11/2026 10:00,0,");
    expect(last).toBe(",,NOT_IN_WIX,,333,DEMO ONLY,1,0,1,0,0,0,0,-5,0,0,-5,,,,");
  });

  test("terminal summary", async () => {
    const text = formatDailyResults(await build(), period);
    expect(text).toContain("Trade results, 02/11/2026 (Asia/Bangkok)");
    expect(text).toContain("3 people traded: 1 win, 1 loss, 1 demo only.");
    expect(text).toContain("Real, all together: -45.00 THB.");
    expect(text).toContain("not in Wix");
    expect(text).toContain("high +85.00 at 10:00, low +0.00");
  });
});
