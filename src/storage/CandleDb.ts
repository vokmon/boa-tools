import type { Client, InStatement } from "@libsql/client";
import type { RawCandle, UnderlyingInfo } from "@/clients/iqoption/types";

/** complete: the whole day is in the past and inside the broker's history; never fetched again. */
export type DayStatus = "complete" | "partial";

export interface StoredAsset extends UnderlyingInfo {
  firstSeen: string;
  lastSeen: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS candles (
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
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS assets (
    active_id  INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    is_otc     INTEGER NOT NULL,
    precision  INTEGER,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collected_days (
    active_id    INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    day          TEXT NOT NULL,
    status       TEXT NOT NULL,
    candle_count INTEGER NOT NULL,
    collected_at TEXT NOT NULL,
    PRIMARY KEY (active_id, size, day)
  ) WITHOUT ROWID`,
];

/** 11 columns per candle; 80 rows keeps each statement under SQLite's 999-parameter limit. */
const ROWS_PER_INSERT = 80;

/** Raw broker candles in the Turso (libSQL) database. Days are UTC (yyyy-mm-dd). */
export class CandleDb {
  constructor(private readonly db: Client) {}

  async init(): Promise<void> {
    await this.db.batch(SCHEMA, "write");
  }

  /** Adds new assets and refreshes name, flags and last_seen of known ones. */
  async upsertAssets(assets: readonly UnderlyingInfo[], seenAt: Date): Promise<void> {
    const now = seenAt.toISOString();
    await this.db.batch(
      assets.map((a) => ({
        sql: `INSERT INTO assets (active_id, name, is_otc, precision, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (active_id) DO UPDATE SET
                name = excluded.name, is_otc = excluded.is_otc, precision = excluded.precision, last_seen = excluded.last_seen`,
        args: [a.activeId, a.name, a.isOtc ? 1 : 0, a.precision, now, now],
      })),
      "write",
    );
  }

  async listAssets(): Promise<StoredAsset[]> {
    const { rows } = await this.db.execute("SELECT * FROM assets ORDER BY active_id");
    return rows.map((r) => ({
      activeId: Number(r.active_id),
      name: String(r.name),
      isOtc: Number(r.is_otc) === 1,
      precision: r.precision === null ? null : Number(r.precision),
      firstSeen: String(r.first_seen),
      lastSeen: String(r.last_seen),
    }));
  }

  /** Keys `${activeId}|${day}` of the days already marked complete for this candle size. */
  async completeDays(size: number): Promise<Set<string>> {
    const { rows } = await this.db.execute({ sql: "SELECT active_id, day FROM collected_days WHERE size = ? AND status = 'complete'", args: [size] });
    return new Set(rows.map((r) => dayKey(Number(r.active_id), String(r.day))));
  }

  /**
   * Writes one asset-day atomically: its candles and its status row. Candles already stored are
   * kept (the broker only returns closed candles, so they do not change), which saves Turso writes
   * when a partial day is fetched again; `replace` overwrites them instead.
   */
  async saveDay(input: { activeId: number; size: number; day: string; status: DayStatus; candles: readonly RawCandle[]; collectedAt: Date; replace?: boolean }): Promise<void> {
    const { activeId, size } = input;
    const verb = input.replace ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
    const statements: InStatement[] = [];
    for (let i = 0; i < input.candles.length; i += ROWS_PER_INSERT) {
      const chunk = input.candles.slice(i, i + ROWS_PER_INSERT);
      statements.push({
        sql: `${verb} INTO candles (active_id, size, from_ts, id, to_ts, open, close, min, max, volume, at) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
        args: chunk.flatMap((c) => [activeId, size, c.from, c.id, c.to, c.open, c.close, c.min, c.max, c.volume, c.at ?? null]),
      });
    }
    statements.push({
      sql: "INSERT OR REPLACE INTO collected_days (active_id, size, day, status, candle_count, collected_at) VALUES (?, ?, ?, ?, ?, ?)",
      args: [activeId, size, input.day, input.status, input.candles.length, input.collectedAt.toISOString()],
    });
    await this.db.batch(statements, "write");
  }

  /** Candles of one asset in [fromTs, toTs), oldest first. */
  async candles(activeId: number, size: number, fromTs: number, toTs: number): Promise<RawCandle[]> {
    const { rows } = await this.db.execute({
      sql: "SELECT * FROM candles WHERE active_id = ? AND size = ? AND from_ts >= ? AND from_ts < ? ORDER BY from_ts",
      args: [activeId, size, fromTs, toTs],
    });
    return rows.map((r) => ({
      id: Number(r.id),
      from: Number(r.from_ts),
      to: Number(r.to_ts),
      open: Number(r.open),
      close: Number(r.close),
      min: Number(r.min),
      max: Number(r.max),
      volume: Number(r.volume),
      at: r.at === null ? undefined : Number(r.at),
    }));
  }
}

export function dayKey(activeId: number, day: string): string {
  return `${activeId}|${day}`;
}
