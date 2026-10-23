import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RawCandle } from "@/clients/iqoption/types";
import type { Candle } from "@/domain/signal";
import type { DayVersion, StoredAsset } from "./CandleDb";

const DAY_S = 86_400;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  active_id INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  from_ts   INTEGER NOT NULL,
  open      REAL NOT NULL,
  close     REAL NOT NULL,
  min       REAL NOT NULL,
  max       REAL NOT NULL,
  volume    REAL NOT NULL DEFAULT 0,
  id        INTEGER,
  to_ts     INTEGER,
  at        REAL,
  PRIMARY KEY (active_id, size, from_ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS days (
  active_id    INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  day          TEXT NOT NULL,
  candle_count INTEGER NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (active_id, size, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS assets (
  active_id INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  is_otc    INTEGER NOT NULL
);
`;

/**
 * Local copy of the complete days, for the backtest: reading it costs nothing, while every full pass
 * over Turso would use ~11M of its 500M monthly row reads. Holds the candles exactly as Turso does,
 * so days collected while Turso could not be written can be copied back to it later.
 */
export class LocalCandleCache {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    this.addVolumeColumn();
    this.addRawColumns();
  }

  /**
   * Copies made before volume was kept have no volume column: add it and forget which days are
   * held, so the next sync copies everything again with volume (once, ~1 minute).
   */
  private addVolumeColumn(): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(candles)").all().map((c) => c.name);
    if (columns.includes("volume")) return;
    this.db.transaction(() => {
      this.db.exec("ALTER TABLE candles ADD COLUMN volume REAL NOT NULL DEFAULT 0");
      this.db.exec("DELETE FROM days");
    })();
  }

  /**
   * Copies made before the full candles were kept lack id, to_ts and at: add them and forget which
   * days are held, so the next sync copies everything again in full (once).
   */
  private addRawColumns(): void {
    const columns = this.db.query<{ name: string }, []>("PRAGMA table_info(candles)").all().map((c) => c.name);
    if (columns.includes("id")) return;
    this.db.transaction(() => {
      this.db.exec("ALTER TABLE candles ADD COLUMN id INTEGER; ALTER TABLE candles ADD COLUMN to_ts INTEGER; ALTER TABLE candles ADD COLUMN at REAL");
      this.db.exec("DELETE FROM days");
    })();
  }

  /** Adds new assets and refreshes known ones. */
  replaceAssets(assets: readonly Pick<StoredAsset, "activeId" | "name" | "isOtc">[]): void {
    const insert = this.db.prepare("INSERT OR REPLACE INTO assets (active_id, name, is_otc) VALUES ($activeId, $name, $isOtc)");
    this.db.transaction(() => {
      for (const a of assets) insert.run({ activeId: a.activeId, name: a.name, isOtc: a.isOtc ? 1 : 0 });
    })();
  }

  assets(): { activeId: number; name: string; isOtc: boolean }[] {
    return this.db
      .query<{ active_id: number; name: string; is_otc: number }, []>("SELECT active_id, name, is_otc FROM assets ORDER BY active_id")
      .all()
      .map((r) => ({ activeId: r.active_id, name: r.name, isOtc: r.is_otc === 1 }));
  }

  /** collectedAt of every day held here, by `${activeId}|${day}`. */
  dayVersions(size: number): Map<string, string> {
    const rows = this.db.query<{ active_id: number; day: string; collected_at: string }, [number]>("SELECT active_id, day, collected_at FROM days WHERE size = ?").all(size);
    return new Map(rows.map((r) => [`${r.active_id}|${r.day}`, r.collected_at]));
  }

  /** Replaces the given days of one asset with these candles, atomically. */
  replaceDays(activeId: number, size: number, days: readonly DayVersion[], candles: readonly RawCandle[]): void {
    const insertCandle = this.db.prepare(
      "INSERT OR REPLACE INTO candles (active_id, size, from_ts, open, close, min, max, volume, id, to_ts, at) VALUES ($activeId, $size, $from, $open, $close, $min, $max, $volume, $id, $to, $at)",
    );
    const insertDay = this.db.prepare(
      "INSERT OR REPLACE INTO days (active_id, size, day, candle_count, collected_at) VALUES ($activeId, $size, $day, $candleCount, $collectedAt)",
    );
    const deleteDay = this.db.prepare("DELETE FROM candles WHERE active_id = ? AND size = ? AND from_ts >= ? AND from_ts < ?");
    this.db.transaction(() => {
      for (const d of days) {
        const start = Date.parse(`${d.day}T00:00:00Z`) / 1000;
        deleteDay.run(activeId, size, start, start + DAY_S);
      }
      for (const c of candles) insertCandle.run({ activeId, size, from: c.from, open: c.open, close: c.close, min: c.min, max: c.max, volume: c.volume, id: c.id, to: c.to, at: c.at ?? null });
      for (const d of days) insertDay.run({ activeId, size, day: d.day, candleCount: d.candleCount, collectedAt: d.collectedAt });
    })();
  }

  /** Every candle of one asset, oldest first. */
  candles(activeId: number, size: number): Candle[] {
    return this.db
      .query<{ from_ts: number; open: number; close: number; min: number; max: number; volume: number }, [number, number]>(
        "SELECT from_ts, open, close, min, max, volume FROM candles WHERE active_id = ? AND size = ? ORDER BY from_ts",
      )
      .all(activeId, size)
      .map((r) => ({ from: r.from_ts, open: r.open, close: r.close, min: r.min, max: r.max, volume: r.volume }));
  }

  /** The full candles of one asset in [fromTs, toTs), oldest first, as Turso stores them. */
  rawCandles(activeId: number, size: number, fromTs: number, toTs: number): RawCandle[] {
    return this.db
      .query<{ id: number; from_ts: number; to_ts: number; open: number; close: number; min: number; max: number; volume: number; at: number | null }, [number, number, number, number]>(
        "SELECT id, from_ts, to_ts, open, close, min, max, volume, at FROM candles WHERE active_id = ? AND size = ? AND from_ts >= ? AND from_ts < ? ORDER BY from_ts",
      )
      .all(activeId, size, fromTs, toTs)
      .map((r) => ({ id: r.id, from: r.from_ts, to: r.to_ts, open: r.open, close: r.close, min: r.min, max: r.max, volume: r.volume, at: r.at ?? undefined }));
  }

  /** Days held here, oldest first. */
  days(size: number): string[] {
    return this.db.query<{ day: string }, [number]>("SELECT DISTINCT day FROM days WHERE size = ? ORDER BY day").all(size).map((r) => r.day);
  }

  close(): void {
    this.db.close();
  }
}
