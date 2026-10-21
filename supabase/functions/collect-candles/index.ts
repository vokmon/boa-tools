// Supabase Edge Function (Deno): collects one UTC day of 1-minute candles for every IQ Option
// digital-options asset into Turso. Same tables and rules as `bun run collect-candles`.
//
//   POST /functions/v1/collect-candles   body (JSON, every field optional):
//     { "part": 0, "parts": 4 }                       yesterday (UTC), a quarter of the assets (CPU limit)
//     { "day": "2026-10-21", "part": 0, "parts": 4 }  a given day
//     {}                                              yesterday, all assets in one call
//
// Secrets: IQ_OPTION_USER, IQ_OPTION_PASSWORD, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.
import { ClientSdk, LoginPasswordAuthMethod } from "npm:@quadcode-tech/client-sdk-js@1.3.26";
import { createClient, type Client, type InStatement } from "npm:@libsql/client@0.18.0/web";
import process from "node:process";

const SIZE = 60;
const DAY_S = 86_400;
const HALF_DAY_S = DAY_S / 2; // 720 candles per request, under the broker's 1000 cap
const BROKER_HISTORY_S = 86_400 * SIZE; // the broker keeps ~86,400 candles (~60 days)
const SETTLE_S = 120;
const CONCURRENCY = 8;
const ROWS_PER_INSERT = 80; // 11 columns x 80 < 999 parameters
const LOOKAHEAD_HOURS = 24 * 7;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS candles (
    active_id INTEGER NOT NULL, size INTEGER NOT NULL, from_ts INTEGER NOT NULL, id INTEGER NOT NULL,
    to_ts INTEGER NOT NULL, open REAL NOT NULL, close REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL,
    volume REAL NOT NULL, at REAL,
    PRIMARY KEY (active_id, size, from_ts)
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS assets (
    active_id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_otc INTEGER NOT NULL, precision INTEGER,
    first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collected_days (
    active_id INTEGER NOT NULL, size INTEGER NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
    candle_count INTEGER NOT NULL, collected_at TEXT NOT NULL,
    PRIMARY KEY (active_id, size, day)
  ) WITHOUT ROWID`,
];

interface Asset {
  activeId: number;
  name: string;
  isOtc: boolean;
  precision: number | null;
}

interface Candle {
  id: number;
  from: number;
  to: number;
  open: number;
  close: number;
  min: number;
  max: number;
  volume: number;
  at?: number;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret ${name}`);
  return value;
}

/** complete when the day is over and fully inside the broker's history; null when all of it is gone. */
function dayStatus(dayStart: number, nowS: number): "complete" | "partial" | null {
  const oldest = nowS - BROKER_HISTORY_S;
  if (dayStart + DAY_S <= oldest) return null;
  if (dayStart < oldest || dayStart + DAY_S + SETTLE_S > nowS) return "partial";
  return "complete";
}

async function mapWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/** Rows in `candles` for this day and these assets (a range scan per asset on the primary key). */
async function countCandles(db: Client, activeIds: readonly number[], dayStart: number): Promise<number> {
  if (activeIds.length === 0) return 0;
  const { rows } = await db.execute({
    sql: `SELECT count(*) AS n FROM candles WHERE size = ? AND from_ts >= ? AND from_ts < ? AND active_id IN (${activeIds.map(() => "?").join(",")})`,
    args: [SIZE, dayStart, dayStart + DAY_S, ...activeIds],
  });
  return Number(rows[0]?.n ?? 0);
}

const fmt = (n: number) => n.toLocaleString("en-US");

async function upsertAssets(db: Client, assets: readonly Asset[], seenAt: string): Promise<void> {
  await db.batch(
    assets.map((a) => ({
      sql: `INSERT INTO assets (active_id, name, is_otc, precision, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (active_id) DO UPDATE SET
              name = excluded.name, is_otc = excluded.is_otc, precision = excluded.precision, last_seen = excluded.last_seen`,
      args: [a.activeId, a.name, a.isOtc ? 1 : 0, a.precision, seenAt, seenAt],
    })),
    "write",
  );
}

async function saveDay(db: Client, activeId: number, day: string, status: string, candles: readonly Candle[]): Promise<void> {
  const statements: InStatement[] = [];
  for (let i = 0; i < candles.length; i += ROWS_PER_INSERT) {
    const chunk = candles.slice(i, i + ROWS_PER_INSERT);
    statements.push({
      // Stored candles are kept: the broker only returns closed candles, and it saves Turso writes
      sql: `INSERT OR IGNORE INTO candles (active_id, size, from_ts, id, to_ts, open, close, min, max, volume, at) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`,
      args: chunk.flatMap((c) => [activeId, SIZE, c.from, c.id, c.to, c.open, c.close, c.min, c.max, c.volume, c.at ?? null]),
    });
  }
  statements.push({
    sql: "INSERT OR REPLACE INTO collected_days (active_id, size, day, status, candle_count, collected_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [activeId, SIZE, day, status, candles.length, new Date().toISOString()],
  });
  await withRetry(() => db.batch(statements, "write"));
}

async function collect(day: string, part: number, parts: number) {
  const startedAt = Date.now();
  const cpuStart = process.cpuUsage();
  const nowS = Math.floor(Date.now() / 1000);
  const dayStart = Date.parse(`${day}T00:00:00Z`) / 1000;
  const status = dayStatus(dayStart, nowS);
  const tag = `[${day} ${part + 1}/${parts}]`;
  const log = (message: string) => console.log(`${tag} ${message}`);
  log(`🚀 start: day ${day} (UTC), part ${part + 1} of ${parts}${status ? `, will be stored as ${status}` : ""}`);
  if (status === null) {
    log("⛔ day is older than the broker's history (~60 days), nothing to fetch");
    return { day, error: "day is older than the broker's history" };
  }

  const db = createClient({ url: env("TURSO_DATABASE_URL"), authToken: env("TURSO_AUTH_TOKEN") });
  await db.batch(SCHEMA, "write");
  log("🗄️ Turso connected");

  const sdk = await ClientSdk.create(
    "wss://iqoption.com/echo/websocket",
    578,
    new LoginPasswordAuthMethod("https://api.iqoption.com", env("IQ_OPTION_USER"), env("IQ_OPTION_PASSWORD")),
  );
  log("🔐 logged in to IQ Option");
  try {
    // Every underlying tradable at some hour in the next week (main markets close at weekends)
    const digital = await sdk.digitalOptions();
    const actives = await sdk.actives();
    const names = new Map<number, string>();
    for (let h = 0; h <= LOOKAHEAD_HOURS; h++) {
      for (const u of digital.getUnderlyingsAvailableForTradingAt(new Date(Date.now() + h * 3_600_000))) names.set(u.activeId, u.name);
    }
    const scheduled: Asset[] = [];
    await mapWithConcurrency([...names.keys()], 10, async (activeId) => {
      const name = names.get(activeId)!;
      const active = await actives.getActive(activeId).catch(() => undefined);
      scheduled.push({ activeId, name, isOtc: active?.isOtc ?? name.toLowerCase().includes("-otc"), precision: active?.precision ?? null });
    });
    await upsertAssets(db, scheduled, new Date().toISOString());
    log(`📋 ${scheduled.length} assets scheduled by the broker this week`);

    // Assets seen on earlier runs stay in the list; this call takes its share of them
    const { rows: assetRows } = await db.execute("SELECT active_id, name FROM assets ORDER BY active_id");
    const mine = assetRows.filter((_, i) => i % parts === part).map((r) => ({ activeId: Number(r.active_id), name: String(r.name) }));
    const { rows: doneRows } = await db.execute({
      sql: "SELECT active_id FROM collected_days WHERE size = ? AND day = ? AND status = 'complete'",
      args: [SIZE, day],
    });
    const done = new Set(doneRows.map((r) => Number(r.active_id)));
    const todo = mine.filter((a) => !done.has(a.activeId));
    const before = await countCandles(db, mine.map((a) => a.activeId), dayStart);
    log(`📦 this part: ${mine.length} assets, ${done.size ? `${mine.length - todo.length} already complete, ` : ""}${todo.length} to fetch`);
    log(`📊 rows before: ${fmt(before)}`);

    const candlesApi = await sdk.candles();
    let candleCount = 0;
    let finished = 0;
    const failed: string[] = [];
    await mapWithConcurrency(todo, CONCURRENCY, async (asset) => {
      try {
        const byFrom = new Map<number, Candle>();
        for (let from = dayStart; from < dayStart + DAY_S && from <= nowS; from += HALF_DAY_S) {
          const to = Math.min(from + HALF_DAY_S - 1, nowS);
          const batch = await withRetry(() => candlesApi.getCandles(asset.activeId, SIZE, { from, to }));
          if (batch.length >= 1000) throw new Error("request hit the 1000-candle cap");
          for (const c of batch) {
            if (c.from >= dayStart && c.from < dayStart + DAY_S) {
              byFrom.set(c.from, { id: c.id, from: c.from, to: c.to, open: c.open, close: c.close, min: c.min, max: c.max, volume: c.volume, at: c.at });
            }
          }
        }
        const candles = [...byFrom.values()].sort((a, b) => a.from - b.from);
        await saveDay(db, asset.activeId, day, status, candles);
        candleCount += candles.length;
        log(`✅ ${++finished}/${todo.length} ${asset.name}: ${fmt(candles.length)} candles`);
      } catch (error) {
        // Not marked collected, so the next call retries it
        const message = (error as Error)?.message ?? String(error);
        failed.push(`${asset.name} (${asset.activeId}): ${message}`);
        log(`❌ ${++finished}/${todo.length} ${asset.name}: ${message}`);
      }
    });

    const after = await countCandles(db, mine.map((a) => a.activeId), dayStart);
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    const cpuMs = Math.round((process.cpuUsage(cpuStart).user + process.cpuUsage(cpuStart).system) / 1000);
    log(`📊 rows after: ${fmt(after)} (➕ ${fmt(after - before)} added)`);
    log(`${failed.length ? `⚠️ done with ${failed.length} failed (retried by the next call)` : "🏁 done"}: ${todo.length - failed.length} assets fetched, ${fmt(candleCount)} candles received, ${seconds}s, CPU ${cpuMs} ms of 2,000`);

    return {
      day,
      status,
      part: `${part + 1}/${parts}`,
      assets: mine.length,
      skipped: mine.length - todo.length,
      fetched: todo.length - failed.length,
      candles: candleCount,
      rowsBefore: before,
      rowsAfter: after,
      rowsAdded: after - before,
      failed,
      seconds,
      // CPU time of this call; Supabase stops a request at 2,000 ms
      cpuMs,
    };
  } finally {
    sdk.shutdown();
    db.close();
  }
}

interface RequestBody {
  /** UTC day, yyyy-mm-dd; default yesterday. */
  day?: string;
  /** Which share of the assets this call takes, 0..parts-1; default 0. */
  part?: number;
  /** How many shares the assets are split into; default 1 (all in one call). */
  parts?: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "use POST with a JSON body" }, { status: 405 });
  let body: RequestBody;
  try {
    const text = await req.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return Response.json({ error: "body must be JSON, e.g. {\"part\": 0, \"parts\": 4}" }, { status: 400 });
  }
  const yesterday = new Date(Date.now() - DAY_S * 1000).toISOString().slice(0, 10);
  const day = body.day ?? yesterday;
  const parts = body.parts ?? 1;
  const part = body.part ?? 0;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    return Response.json({ error: "day must be yyyy-mm-dd" }, { status: 400 });
  }
  if (!Number.isInteger(parts) || parts < 1 || !Number.isInteger(part) || part < 0 || part >= parts) {
    return Response.json({ error: "part must be an integer 0..parts-1" }, { status: 400 });
  }
  try {
    const result = await collect(day, part, parts);
    return Response.json(result, { status: "failed" in result && result.failed?.length ? 207 : 200 });
  } catch (error) {
    console.error(`💥 ${day} part ${part + 1}/${parts} failed:`, error);
    return Response.json({ error: (error as Error)?.message ?? String(error) }, { status: 500 });
  }
});
