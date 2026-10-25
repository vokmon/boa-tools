import { describe, expect, test } from "bun:test";
import { formatAmount, formatPnl, parseClosedPosition, sourceOf, sumByUser } from "@/domain/trading";
import { nextCursor } from "@/clients/sentry/LogSearchService";

const row = (message: string, balance = '{"type":"real","currency":"THB"}') => ({ message, balance, timestamp: "2026-10-18T03:00:00+00:00" });

describe("parseClosedPosition", () => {
  test("reads amount, orders, user and balance", () => {
    expect(parseClosedPosition(row("Position closed (-1.00) - order (11, 12) - user_iq: 100000001"))).toEqual({
      iqOptionId: "100000001",
      orderKey: "11,12",
      pnlCents: -100,
      closedAt: new Date("2026-10-18T03:00:00Z"),
      account: "real",
      currency: "THB",
      balanceAfter: null,
    });
  });

  test("keeps the amount when the balance is unreadable", () => {
    expect(parseClosedPosition(row("Position closed (0.86) - order (1) - user_iq: 1", "{broken"))).toMatchObject({
      pnlCents: 86,
      account: "unknown",
      currency: "?",
    });
  });

  test("skips logs without an amount or of another kind", () => {
    expect(parseClosedPosition(row("Position closed (undefined) - order (1) - user_iq: 1"))).toBeNull();
    expect(parseClosedPosition(row("Order placed failed - user_iq: 1"))).toBeNull();
  });
});

const result = (trades: number, wins: number, losses: number, pnl: number) => ({ trades, wins, losses, pnl });
const none = result(0, 0, 0, 0);
const placed = (orderId: string, bySystem: boolean): PlacedOrder => ({
  orderId, iqOptionId: "1", bySystem, stakeCents: 100, placedAt: new Date(), account: "real", currency: "THB",
});

describe("sumByUser", () => {
  test("sums in cents without float drift, drops duplicate orders and splits by source", () => {
    const base = { iqOptionId: "1", account: "real", currency: "THB", closedAt: new Date(), balanceAfter: null };
    const positions = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...base, orderKey: String(i), pnlCents: 10 })),
      { ...base, orderKey: "0", pnlCents: 10 },
    ];
    expect(sumByUser(positions, [placed("0", true), placed("1", false)]).get("1")).toEqual([
      { account: "real", currency: "THB", ...result(10, 10, 0, 1), bySource: { system: result(1, 1, 0, 0.1), manual: result(1, 1, 0, 0.1), outside: result(8, 8, 0, 0.8) } },
    ]);
  });
});

describe("sourceOf", () => {
  const position = (orderKey: string) => ({ iqOptionId: "1", orderKey, pnlCents: 0, closedAt: new Date(), account: "real", currency: "THB", balanceAfter: null });
  const orders = new Map([["12", placed("12", false)], ["20", placed("20", true)]]);

  test("bot or manual from the app's order log, outside when the app never logged the order", () => {
    expect(sourceOf(position("20"), orders)).toBe("system");
    expect(sourceOf(position("11,12"), orders)).toBe("manual");
    expect(sourceOf(position("99"), orders)).toBe("outside");
  });
});

describe("formatting", () => {
  test("signs and thousands separators", () => {
    expect(formatAmount(1234.5)).toBe("+1,234.50");
    expect(formatAmount(-20)).toBe("-20.00");
    expect(
      formatPnl([{ account: "real", currency: "THB", ...result(2, 1, 1, 5), bySource: { system: result(1, 1, 0, 8), manual: none, outside: result(1, 0, 1, -3) } }]),
    ).toBe("real +5.00 THB (system +8.00, outside -3.00)");
  });
});

describe("nextCursor", () => {
  test("follows only a next link that has results", () => {
    const link = '<https://x/?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", <https://x/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"';
    expect(nextCursor(link)).toBe("0:100:0");
    expect(nextCursor(link.replace('results="true"', 'results="false"'))).toBeUndefined();
    expect(nextCursor(null)).toBeUndefined();
  });
});

import { iqOptionIdInMessage, parsePlacedOrder, summarizeAccounts, type ClosedPosition, type PlacedOrder } from "@/domain/trading";

describe("parsePlacedOrder", () => {
  test("reads bot/manual, order id, stake, user and balance", () => {
    expect(
      parsePlacedOrder({
        message: "Order placed successfully (manual) (555) 2436/USDPHP-OTC - Amount: 1000.50 - user_iq: 42",
        order: '{"balanceType":"real","balanceCurrency":"THB"}',
        timestamp: "2026-10-18T03:00:00+00:00",
      }),
    ).toEqual({
      orderId: "555",
      iqOptionId: "42",
      bySystem: false,
      stakeCents: 100050,
      placedAt: new Date("2026-10-18T03:00:00Z"),
      account: "real",
      currency: "THB",
    });
  });

  test("ignores other messages", () => {
    expect(parsePlacedOrder({ message: "Order placed failed - user_iq: 1", timestamp: "2026-10-18T03:00:00Z" })).toBeNull();
  });

  test("finds the IQ Option id in any app message", () => {
    expect(iqOptionIdInMessage("Martingale chain updated - user_iq: 100000001")).toBe("100000001");
    expect(iqOptionIdInMessage("no id")).toBeUndefined();
  });
});

describe("summarizeAccounts", () => {
  const at = new Date("2026-10-18T03:00:00Z");
  const order = (orderId: string, account: string, stakeCents: number, bySystem = true): PlacedOrder => ({
    orderId, iqOptionId: "1", bySystem, stakeCents, placedAt: at, account, currency: account === "real" ? "THB" : "USD",
  });
  const closed = (orderKey: string, account: string, pnlCents: number, balanceAfter: number | null, minutes: number): ClosedPosition => ({
    iqOptionId: "1", orderKey, pnlCents, account, currency: account === "real" ? "THB" : "USD",
    closedAt: new Date(at.getTime() + minutes * 60_000), balanceAfter,
  });

  test("counts orders and results per account, de-duplicated, with the latest balance and sources", () => {
    const summary = summarizeAccounts(
      [order("1", "real", 10000), order("1", "real", 10000), order("2", "real", 5000, false), order("3", "demo", 100)],
      [
        closed("1", "real", 8500, 1085, 1),
        closed("1", "real", 8500, 1085, 1),
        closed("2", "real", -5000, 1035, 2),
        closed("3", "demo", -100, 99, 3),
        closed("4", "demo", 50, 99.5, 4),
      ],
    );
    expect(summary).toEqual([
      {
        account: "real", currency: "THB", orders: 2, botOrders: 1, manualOrders: 1, stake: 150, closed: 2, wins: 1, losses: 1, winRate: 0.5, pnl: 35, latestBalance: 1035,
        bySource: { system: result(1, 1, 0, 85), manual: result(1, 0, 1, -50), outside: none },
      },
      {
        account: "demo", currency: "USD", orders: 1, botOrders: 1, manualOrders: 0, stake: 1, closed: 2, wins: 1, losses: 1, winRate: 0.5, pnl: -0.5, latestBalance: 99.5,
        bySource: { system: result(1, 0, 1, -1), manual: none, outside: result(1, 1, 0, 0.5) },
      },
    ]);
  });

  test("known orders tell the source without being counted", () => {
    const [real] = summarizeAccounts([], [closed("7", "real", 100, null, 1)], [order("7", "real", 100, false)]);
    expect(real).toMatchObject({ orders: 0, closed: 1, bySource: { system: none, manual: result(1, 1, 0, 1), outside: none } });
  });

  test("an account with orders but nothing closed has no win rate", () => {
    expect(summarizeAccounts([order("1", "real", 100)], [])[0]!.winRate).toBeNull();
  });
});
