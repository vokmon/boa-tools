import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RawCandle, UnderlyingInfo } from "@/clients/iqoption/types";

/** complete: the whole day is in the past and inside the broker's history; never fetched again. */
export type DayStatus = "complete" | "partial";

export interface StoredAsset extends UnderlyingInfo {
  firstSeen: string;
  lastSeen: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  active_id INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  from_ts   INTEGER NOT NULL,
  id        INTEGER NOT NULL,
  to_ts     INTEGER NOT NULL,
  open      REAL NOT NULL,
  close     REAL NOT NULL,
  min       REAL NOT NULL,
  max       REAL NOT NULL,
  volume    REAL NOT NULL,
  at        REAL, -- nanoseconds; REAL because it exceeds what a JS number holds exactly
  PRIMARY KEY (active_id, size, from_ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS assets (
  active_id  INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  is_otc     INTEGER NOT NULL,
  precision  INTEGER,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collected_days (
  active_id    INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  day          TEXT NOT NULL,
  status       TEXT NOT NULL,
  candle_count INTEGER NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (active_id, size, day)
) WITHOUT ROWID;
`;

/** Raw broker candles in one SQLite file. Days are UTC (yyyy-mm-dd). */
export class CandleStore {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
  }

  /** Adds new assets and refreshes name, flags and last_seen of known ones. */
  upsertAssets(assets: readonly UnderlyingInfo[], seenAt: Date): void {
    const now = seenAt.toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO assets (active_id, name, is_otc, precision, first_seen, last_seen)
      VALUES ($activeId, $name, $isOtc, $precision, $now, $now)
      ON CONFLICT (active_id) DO UPDATE SET
        name = excluded.name, is_otc = excluded.is_otc, precision = excluded.precision, last_seen = excluded.last_seen`);
    this.db.transaction(() => {
      for (const a of assets) stmt.run({ activeId: a.activeId, name: a.name, isOtc: a.isOtc ? 1 : 0, precision: a.precision, now });
    })();
  }

  listAssets(): StoredAsset[] {
    return this.db
      .query<{ active_id: number; name: string; is_otc: number; precision: number | null; first_seen: string; last_seen: string }, []>(
        "SELECT * FROM assets ORDER BY active_id",
      )
      .all()
      .map((r) => ({ activeId: r.active_id, name: r.name, isOtc: r.is_otc === 1, precision: r.precision, firstSeen: r.first_seen, lastSeen: r.last_seen }));
  }

  /** Keys `${activeId}|${day}` of the days already marked complete for this candle size. */
  completeDays(size: number): Set<string> {
    const rows = this.db
      .query<{ active_id: number; day: string }, [number]>("SELECT active_id, day FROM collected_days WHERE size = ? AND status = 'complete'")
      .all(size);
    return new Set(rows.map((r) => dayKey(r.active_id, r.day)));
  }

  /** Writes one asset-day atomically: its candles and its status row. */
  saveDay(input: { activeId: number; size: number; day: string; status: DayStatus; candles: readonly RawCandle[]; collectedAt: Date }): void {
    const insertCandle = this.db.prepare(`
      INSERT OR REPLACE INTO candles (active_id, size, from_ts, id, to_ts, open, close, min, max, volume, at)
      VALUES ($activeId, $size, $from, $id, $to, $open, $close, $min, $max, $volume, $at)`);
    const insertDay = this.db.prepare(`
      INSERT OR REPLACE INTO collected_days (active_id, size, day, status, candle_count, collected_at)
      VALUES ($activeId, $size, $day, $status, $count, $collectedAt)`);
    const { activeId, size } = input;
    this.db.transaction(() => {
      for (const c of input.candles) {
        insertCandle.run({ activeId, size, from: c.from, id: c.id, to: c.to, open: c.open, close: c.close, min: c.min, max: c.max, volume: c.volume, at: c.at ?? null });
      }
      insertDay.run({ activeId, size, day: input.day, status: input.status, count: input.candles.length, collectedAt: input.collectedAt.toISOString() });
    })();
  }

  /** Candles of one asset in [fromTs, toTs), oldest first. */
  candles(activeId: number, size: number, fromTs: number, toTs: number): RawCandle[] {
    return this.db
      .query<{ id: number; from_ts: number; to_ts: number; open: number; close: number; min: number; max: number; volume: number; at: number | null }, [number, number, number, number]>(
        "SELECT * FROM candles WHERE active_id = ? AND size = ? AND from_ts >= ? AND from_ts < ? ORDER BY from_ts",
      )
      .all(activeId, size, fromTs, toTs)
      .map((r) => ({ id: r.id, from: r.from_ts, to: r.to_ts, open: r.open, close: r.close, min: r.min, max: r.max, volume: r.volume, at: r.at ?? undefined }));
  }

  close(): void {
    this.db.close();
  }
}

export function dayKey(activeId: number, day: string): string {
  return `${activeId}|${day}`;
}
