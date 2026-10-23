import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import type { RawCandle } from "@/clients/iqoption/types";
import { CandleDb, isWriteBlocked } from "@/storage/CandleDb";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { MirroredStore } from "@/tools/backtest/data/MirroredStore";
import { backfillTurso } from "@/tools/backtest/data/backfillTurso";
import { CandleSync } from "@/tools/backtest/data/CandleSync";

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const BLOCKED = "SQL write operations are forbidden (writes are blocked, do you need to upgrade your plan?)";

function dayOfCandles(day: string): RawCandle[] {
  return Array.from({ length: 1440 }, (_, i) => {
    const from = dayStart(day) + i * 60;
    return { id: from / 60, from, to: from + 60, open: 1, close: 2, min: 0.5, max: 2.5, volume: 3, at: (from + 60) * 1e9 };
  });
}

/** An in-memory Turso whose writes can be refused, as when the monthly write limit is used up. */
async function turso(): Promise<{ db: CandleDb; block: (on: boolean) => void }> {
  const db = new CandleDb(createClient({ url: ":memory:" }));
  await db.init();
  let blocked = false;
  const guard = <T extends unknown[], R>(write: (...args: T) => Promise<R>) => async (...args: T) => {
    if (blocked) throw new Error(BLOCKED);
    return write(...args);
  };
  db.saveDay = guard(db.saveDay.bind(db));
  db.upsertAssets = guard(db.upsertAssets.bind(db));
  return { db, block: (on) => (blocked = on) };
}

const save = (store: { saveDay: MirroredStore["saveDay"] }, activeId: number, day: string, status: "complete" | "partial" = "complete") =>
  store.saveDay({ activeId, size: 60, day, status, candles: dayOfCandles(day), collectedAt: new Date(`${day}T23:59:00Z`) });

describe("keeping the local copy and Turso in sync", () => {
  test("Turso's write-limit error is recognised", () => {
    expect(isWriteBlocked(new Error(BLOCKED))).toBe(true);
    expect(isWriteBlocked(new Error("network down"))).toBe(false);
  });

  test("while Turso refuses writes, days go to the local copy only; a later run copies them to Turso", async () => {
    const { db, block } = await turso();
    const local = new LocalCandleCache(":memory:");
    await db.upsertAssets([{ activeId: 1, name: "A1", isOtc: false, precision: 5 }], new Date());

    // A run while Turso works: both places get the day
    const first = new MirroredStore(db, local);
    await first.completeDays(60);
    await save(first, 1, "2026-10-20");
    expect(first.tursoBlocked).toBe(false);
    expect((await db.completeDays(60)).has("1|2026-10-20")).toBe(true);

    // Turso hits its limit: the run carries on with the local copy only
    block(true);
    const second = new MirroredStore(db, local);
    expect([...(await second.completeDays(60))]).toEqual(["1|2026-10-20"]);
    await save(second, 1, "2026-10-21");
    await save(second, 1, "2026-10-22");
    await save(second, 1, "2026-10-23", "partial");
    expect(second).toMatchObject({ tursoBlocked: true, localOnly: 2 });
    expect(local.days(60)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect([...(await db.completeDays(60))]).toEqual(["1|2026-10-20"]);
    // Still refused: the backfill stops without failing
    expect(await backfillTurso(db, local, 60)).toEqual({ missing: 2, copied: 0, candles: 0, blocked: true });

    // The limit resets: the local-only days are copied to Turso, in full and as the same version
    block(false);
    expect(await backfillTurso(db, local, 60)).toEqual({ missing: 2, copied: 2, candles: 2 * 1440, blocked: false });
    expect([...(await db.completeDays(60))].sort()).toEqual(["1|2026-10-20", "1|2026-10-21", "1|2026-10-22"]);
    expect(await db.rawCandles(1, 60, dayStart("2026-10-21"), dayStart("2026-10-22"))).toEqual(dayOfCandles("2026-10-21"));
    expect(await new CandleSync(db, local).sync(60)).toMatchObject({ copied: 0, upToDate: 3 });
    expect(await backfillTurso(db, local, 60)).toMatchObject({ missing: 0, copied: 0 });
  });

  test("a day only Turso has is not fetched again; the sync copies it in full", async () => {
    const { db } = await turso();
    const local = new LocalCandleCache(":memory:");
    await db.upsertAssets([{ activeId: 1, name: "A1", isOtc: true, precision: 5 }], new Date());
    await db.saveDay({ activeId: 1, size: 60, day: "2026-10-20", status: "complete", candles: dayOfCandles("2026-10-20"), collectedAt: new Date() });

    expect([...(await new MirroredStore(db, local).completeDays(60))]).toEqual(["1|2026-10-20"]);
    await new CandleSync(db, local).sync(60);
    expect(local.rawCandles(1, 60, dayStart("2026-10-20"), dayStart("2026-10-21"))).toEqual(dayOfCandles("2026-10-20"));
  });

  test("a local copy made before full candles were kept gets the columns and is copied again", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "local-")), "candles.sqlite");
    const old = new Database(path, { create: true });
    old.exec(`CREATE TABLE candles (active_id INTEGER NOT NULL, size INTEGER NOT NULL, from_ts INTEGER NOT NULL, open REAL NOT NULL, close REAL NOT NULL,
      min REAL NOT NULL, max REAL NOT NULL, volume REAL NOT NULL DEFAULT 0, PRIMARY KEY (active_id, size, from_ts)) WITHOUT ROWID;
      CREATE TABLE days (active_id INTEGER NOT NULL, size INTEGER NOT NULL, day TEXT NOT NULL, candle_count INTEGER NOT NULL, collected_at TEXT NOT NULL,
      PRIMARY KEY (active_id, size, day)) WITHOUT ROWID;
      INSERT INTO days VALUES (1, 60, '2026-10-20', 1440, 'x');`);
    old.close();

    const local = new LocalCandleCache(path);
    // The day is forgotten, so the next sync copies it again in full
    expect(local.days(60)).toEqual([]);
    local.replaceDays(1, 60, [{ activeId: 1, day: "2026-10-20", candleCount: 1440, collectedAt: "y" }], dayOfCandles("2026-10-20"));
    expect(local.rawCandles(1, 60, dayStart("2026-10-20"), dayStart("2026-10-21"))).toEqual(dayOfCandles("2026-10-20"));
    local.close();
  });
});
