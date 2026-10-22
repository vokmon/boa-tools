import type { RawCandle, UnderlyingInfo } from "@/clients/iqoption/types";
import { dayKey, type CandleDb, type DayStatus } from "@/storage/CandleDb";
import { mapWithConcurrency } from "@/lib/concurrency";
import { logger } from "@/lib/logger";

const DAY_S = 86_400;
/** The broker keeps about this many candles per asset and size (60 days of 1-minute candles). */
export const BROKER_HISTORY_CANDLES = 86_400;
/** A day counts as finished this long after midnight UTC, so the last candle has settled. */
const SETTLE_S = 120;
const CONCURRENCY = 8;

export interface DayFetcher {
  fetchDay(activeId: number, size: number, dayStart: number): Promise<RawCandle[]>;
}

export interface CollectInput {
  assets: readonly UnderlyingInfo[];
  /** UTC days, yyyy-mm-dd. */
  days: readonly string[];
  size: number;
  force: boolean;
  now: Date;
}

export interface CollectSummary {
  fetched: number;
  skipped: number;
  failed: string[];
  candles: number;
  partial: number;
  /** Days that end before the broker's history starts; nothing to fetch. */
  beyondHistory: string[];
}

/** Start of the broker's history for this size, in unix seconds. */
export function historyStart(now: Date, size: number): number {
  return Math.floor(now.getTime() / 1000) - BROKER_HISTORY_CANDLES * size;
}

/**
 * complete when the day is over and fully inside the broker's history, otherwise partial (it will be
 * fetched again next run). null when the whole day is older than the history.
 */
export function dayStatus(day: string, now: Date, size: number): DayStatus | null {
  const start = Date.parse(`${day}T00:00:00Z`) / 1000;
  const end = start + DAY_S;
  const nowS = Math.floor(now.getTime() / 1000);
  const oldest = historyStart(now, size);
  if (end <= oldest) return null;
  if (start < oldest || end + SETTLE_S > nowS) return "partial";
  return "complete";
}

/** First UTC day the broker still has in full, yyyy-mm-dd. */
export function firstFullDay(now: Date, size: number): string {
  const start = Math.ceil(historyStart(now, size) / DAY_S) * DAY_S;
  return new Date(start * 1000).toISOString().slice(0, 10);
}

export interface DayReport {
  day: string;
  status: DayStatus;
  /** Assets fetched this run; 0 when the whole day was already collected. */
  fetched: number;
  candles: number;
  seconds: number;
}

/** How the collector reports progress; the default prints one line per day. */
export interface CollectEvents {
  day(report: DayReport): void;
  failed(day: string, asset: string, message: string): void;
}

export const lineEvents: CollectEvents = {
  day: (r) =>
    logger.info(r.fetched === 0 ? `${r.day}  already collected` : `${r.day}  ${r.fetched} assets  ${r.candles.toLocaleString("en-US")} candles  ${r.seconds.toFixed(1)}s${r.status === "partial" ? "  (partial)" : ""}`),
  failed: (day, asset, message) => logger.warn(`${day} ${asset}: ${message}`),
};

export class CandleCollector {
  constructor(
    private readonly db: Pick<CandleDb, "completeDays" | "saveDay">,
    private readonly fetcher: DayFetcher,
    private readonly events: CollectEvents = lineEvents,
  ) {}

  async collect(input: CollectInput): Promise<CollectSummary> {
    const { assets, size, now } = input;
    const done = input.force ? new Set<string>() : await this.db.completeDays(size);
    const summary: CollectSummary = { fetched: 0, skipped: 0, failed: [], candles: 0, partial: 0, beyondHistory: [] };

    for (const day of input.days) {
      const status = dayStatus(day, now, size);
      if (status === null) {
        summary.beyondHistory.push(day);
        continue;
      }
      const todo = assets.filter((a) => !done.has(dayKey(a.activeId, day)));
      summary.skipped += assets.length - todo.length;
      if (todo.length === 0) {
        this.events.day({ day, status, fetched: 0, candles: 0, seconds: 0 });
        continue;
      }

      const startedAt = Date.now();
      let dayCandles = 0;
      const dayStart = Date.parse(`${day}T00:00:00Z`) / 1000;
      await mapWithConcurrency(todo, CONCURRENCY, async (asset) => {
        try {
          const candles = await this.fetcher.fetchDay(asset.activeId, size, dayStart);
          await this.db.saveDay({ activeId: asset.activeId, size, day, status, candles, collectedAt: new Date(), replace: input.force });
          summary.fetched++;
          dayCandles += candles.length;
          if (status === "partial") summary.partial++;
        } catch (error) {
          // Not marked collected, so the next run retries it
          const message = (error as Error)?.message ?? String(error);
          summary.failed.push(`${day} ${asset.name} (${asset.activeId}): ${message}`);
          this.events.failed(day, asset.name, message);
        }
      });
      summary.candles += dayCandles;
      this.events.day({ day, status, fetched: todo.length, candles: dayCandles, seconds: (Date.now() - startedAt) / 1000 });
    }
    return summary;
  }
}
