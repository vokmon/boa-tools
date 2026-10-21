import { describe, expect, test } from "bun:test";
import { CandlesService } from "@/clients/iqoption/CandlesService";
import type { RawCandle } from "@/clients/iqoption/types";
import { CandleStore } from "@/storage/CandleStore";
import { CandleCollector, dayStatus, firstFullDay } from "@/tools/collect-candles/CandleCollector";

const NOW = new Date("2026-10-21T08:00:00Z");
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

function candle(from: number): RawCandle {
  return { id: from / 60, from, to: from + 60, open: 1, close: 2, min: 0.5, max: 2.5, volume: 0, at: (from + 60) * 1e9 };
}

/** A broker with a candle every minute; like the real one it returns only the newest 1000 in range. */
function fakeCandles() {
  const calls: { from: number; to: number }[] = [];
  return {
    calls,
    async getCandles(_activeId: number, size: number, options?: { from?: number; to?: number }) {
      const { from = 0, to = 0 } = options ?? {};
      calls.push({ from, to });
      const all: RawCandle[] = [];
      for (let t = Math.ceil(from / size) * size; t <= to; t += size) all.push(candle(t));
      return all.slice(-1000) as never;
    },
  };
}

describe("dayStatus", () => {
  test("a finished day inside the history is complete", () => {
    expect(dayStatus("2026-10-20", NOW, 60)).toBe("complete");
  });

  test("today is partial", () => {
    expect(dayStatus("2026-10-21", NOW, 60)).toBe("partial");
  });

  test("the edge day is partial and older days are beyond the history", () => {
    // history starts 60 days before NOW: 2026-08-22T08:00Z
    expect(dayStatus("2026-08-22", NOW, 60)).toBe("partial");
    expect(dayStatus("2026-08-21", NOW, 60)).toBeNull();
    expect(firstFullDay(NOW, 60)).toBe("2026-08-23");
  });
});

describe("CandlesService.fetchDay", () => {
  test("gets all 1440 candles of a day in two requests, nothing outside the day", async () => {
    const api = fakeCandles();
    const candles = await new CandlesService(api).fetchDay(1, 60, dayStart("2026-10-20"));
    expect(candles).toHaveLength(1440);
    expect(candles[0]!.from).toBe(dayStart("2026-10-20"));
    expect(candles.at(-1)!.from).toBe(dayStart("2026-10-21") - 60);
    expect(api.calls).toHaveLength(2);
  });

  test("today stops at now instead of asking for the future", async () => {
    const api = fakeCandles();
    const now = dayStart("2026-10-21") + 7 * 3600 + 30 * 60; // 07:30 UTC
    const candles = await new CandlesService(api, () => now).fetchDay(1, 60, dayStart("2026-10-21"));
    expect(api.calls).toEqual([{ from: dayStart("2026-10-21"), to: now }]);
    expect(candles.at(-1)!.from).toBe(now);
  });
});

describe("CandleCollector", () => {
  const assets = [
    { activeId: 1, name: "EURUSD", isOtc: false, precision: 6 },
    { activeId: 76, name: "EURUSD-OTC", isOtc: true, precision: 6 },
  ];

  test("stores candles and skips complete days on the next run", async () => {
    const store = new CandleStore(":memory:");
    const api = fakeCandles();
    const collector = new CandleCollector(store, new CandlesService(api));

    const first = await collector.collect({ assets, days: ["2026-10-19", "2026-10-20"], size: 60, force: false, now: NOW });
    expect(first).toMatchObject({ fetched: 4, skipped: 0, candles: 4 * 1440, partial: 0, failed: [] });
    expect(store.candles(76, 60, dayStart("2026-10-20"), dayStart("2026-10-21"))).toHaveLength(1440);

    const calls = api.calls.length;
    const second = await collector.collect({ assets, days: ["2026-10-19", "2026-10-20"], size: 60, force: false, now: NOW });
    expect(second).toMatchObject({ fetched: 0, skipped: 4 });
    expect(api.calls.length).toBe(calls);

    const forced = await collector.collect({ assets, days: ["2026-10-20"], size: 60, force: true, now: NOW });
    expect(forced).toMatchObject({ fetched: 2, skipped: 0 });
    expect(store.candles(1, 60, dayStart("2026-10-20"), dayStart("2026-10-21"))).toHaveLength(1440);
  });

  test("partial days are fetched again, days beyond the history are not fetched", async () => {
    const store = new CandleStore(":memory:");
    const api = fakeCandles();
    const collector = new CandleCollector(store, new CandlesService(api));

    const run = () => collector.collect({ assets, days: ["2026-08-21", "2026-10-21"], size: 60, force: false, now: NOW });
    const first = await run();
    expect(first).toMatchObject({ fetched: 2, partial: 2, beyondHistory: ["2026-08-21"] });
    expect((await run()).fetched).toBe(2);
  });

  test("a failing asset-day is reported and not marked collected", async () => {
    const store = new CandleStore(":memory:");
    const fetcher = {
      async fetchDay(activeId: number) {
        if (activeId === 76) throw new Error("boom");
        return [candle(dayStart("2026-10-20"))];
      },
    };
    const summary = await new CandleCollector(store, fetcher).collect({ assets, days: ["2026-10-20"], size: 60, force: false, now: NOW });
    expect(summary.fetched).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(store.completeDays(60)).toEqual(new Set(["1|2026-10-20"]));
  });
});

describe("dataDir", () => {
  test("defaults to data and follows DATA_DIR", async () => {
    const { dataDir } = await import("@/config/env");
    expect(dataDir({})).toBe("data");
    expect(dataDir({ DATA_DIR: "  " })).toBe("data");
    expect(dataDir({ DATA_DIR: "/Volumes/ext/boa" })).toBe("/Volumes/ext/boa");
  });
});
