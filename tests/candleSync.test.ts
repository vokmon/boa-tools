import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import type { RawCandle } from "@/clients/iqoption/types";
import { CandleDb } from "@/storage/CandleDb";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { CandleSync, groupIntoRequests } from "@/tools/backtest/data/CandleSync";

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

function dayOfCandles(day: string, close = 2): RawCandle[] {
  return Array.from({ length: 1440 }, (_, i) => {
    const from = dayStart(day) + i * 60;
    return { id: from / 60, from, to: from + 60, open: 1, close, min: 0.5, max: 2.5, volume: 0, at: (from + 60) * 1e9 };
  });
}

async function remoteWith(days: { activeId: number; day: string; status?: "complete" | "partial"; close?: number; at?: string }[]): Promise<CandleDb> {
  const db = new CandleDb(createClient({ url: ":memory:" }));
  await db.init();
  await db.upsertAssets(
    [...new Set(days.map((d) => d.activeId))].map((activeId) => ({ activeId, name: `A${activeId}`, isOtc: true, precision: 6 })),
    new Date("2026-10-01T00:00:00Z"),
  );
  for (const d of days) {
    await db.saveDay({ activeId: d.activeId, size: 60, day: d.day, status: d.status ?? "complete", candles: dayOfCandles(d.day, d.close), collectedAt: new Date(d.at ?? "2026-10-21T00:00:00Z"), replace: true });
  }
  return db;
}

describe("CandleSync", () => {
  test("copies complete days once, then only what changed", async () => {
    const remote = await remoteWith([
      { activeId: 1, day: "2026-10-19" },
      { activeId: 1, day: "2026-10-20" },
      { activeId: 2, day: "2026-10-20" },
      { activeId: 2, day: "2026-10-21", status: "partial" },
    ]);
    const local = new LocalCandleCache(":memory:");
    const sync = new CandleSync(remote, local);

    expect(await sync.sync(60)).toEqual({ copied: 3, upToDate: 0, candles: 3 * 1440 });
    expect(local.candles(1, 60)).toHaveLength(2 * 1440);
    // Partial days stay out of the local copy
    expect(local.candles(2, 60)).toHaveLength(1440);
    expect(local.assets().map((a) => a.name)).toEqual(["A1", "A2"]);

    expect(await sync.sync(60)).toEqual({ copied: 0, upToDate: 3, candles: 0 });

    // The day is collected again in Turso (new collectedAt): the local copy is replaced
    await remote.saveDay({ activeId: 1, size: 60, day: "2026-10-20", status: "complete", candles: dayOfCandles("2026-10-20", 3), collectedAt: new Date("2026-10-22T00:00:00Z"), replace: true });
    expect(await sync.sync(60)).toEqual({ copied: 1, upToDate: 2, candles: 1440 });
    const day = local.candles(1, 60).filter((c) => c.from >= dayStart("2026-10-20"));
    expect(day).toHaveLength(1440);
    expect(day.every((c) => c.close === 3)).toBe(true);

    // The partial day finishes in Turso and is copied next time
    await remote.saveDay({ activeId: 2, size: 60, day: "2026-10-21", status: "complete", candles: dayOfCandles("2026-10-21"), collectedAt: new Date("2026-10-22T00:10:00Z") });
    expect((await sync.sync(60)).copied).toBe(1);
    expect(local.days(60)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  });
});

describe("groupIntoRequests", () => {
  const v = (activeId: number, day: string) => ({ activeId, day, candleCount: 1440, collectedAt: "x" });

  test("consecutive days share a request, up to 7; gaps and assets split", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10"];
    const requests = groupIntoRequests([...days.map((d) => v(1, d)), v(2, "2026-10-01")]);
    expect(requests.map((r) => [r.activeId, r.days.map((d) => d.day.slice(8))])).toEqual([
      [1, ["01", "02", "03", "04", "05", "06", "07"]],
      [1, ["08"]],
      [1, ["10"]],
      [2, ["01"]],
    ]);
  });
});
