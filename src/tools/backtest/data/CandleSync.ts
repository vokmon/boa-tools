import type { CandleDb, DayVersion } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { mapWithConcurrency } from "@/lib/concurrency";
import { retry } from "@/lib/retry";

const DAY_MS = 86_400_000;
/** Days per Turso request: ~10k rows, well inside one response. */
const DAYS_PER_REQUEST = 7;
const CONCURRENCY = 6;

export interface SyncSummary {
  /** Asset-days copied because they were new or changed in Turso. */
  copied: number;
  upToDate: number;
  candles: number;
}

/** How the sync reports progress. */
export interface SyncEvents {
  start(assetDays: number, requests: number): void;
  request(): void;
}

/** Copies complete asset-days from Turso into the local copy, in full; only new or changed days are read. */
export class CandleSync {
  constructor(
    private readonly remote: Pick<CandleDb, "completeDayVersions" | "rawCandles" | "listAssets">,
    private readonly local: Pick<LocalCandleCache, "dayVersions" | "replaceDays" | "replaceAssets">,
  ) {}

  async sync(size: number, events?: SyncEvents): Promise<SyncSummary> {
    this.local.replaceAssets(await this.remote.listAssets());
    const remote = await this.remote.completeDayVersions(size);
    const local = this.local.dayVersions(size);
    const stale = remote.filter((d) => local.get(`${d.activeId}|${d.day}`) !== d.collectedAt);
    const summary: SyncSummary = { copied: 0, upToDate: remote.length - stale.length, candles: 0 };
    if (stale.length === 0) return summary;

    const requests = groupIntoRequests(stale);
    events?.start(stale.length, requests.length);
    await mapWithConcurrency(requests, CONCURRENCY, async ({ activeId, days }) => {
      const from = Date.parse(`${days[0]!.day}T00:00:00Z`) / 1000;
      const to = Date.parse(`${days.at(-1)!.day}T00:00:00Z`) / 1000 + DAY_MS / 1000;
      const candles = await retry(() => this.remote.rawCandles(activeId, size, from, to), { label: `read ${activeId} ${days[0]!.day}` });
      this.local.replaceDays(activeId, size, days, candles);
      summary.copied += days.length;
      summary.candles += candles.length;
      events?.request();
    });
    return summary;
  }
}

/** Stale days per asset, cut into runs of consecutive days of at most DAYS_PER_REQUEST. */
export function groupIntoRequests(stale: readonly DayVersion[]): { activeId: number; days: DayVersion[] }[] {
  const byAsset = new Map<number, DayVersion[]>();
  for (const d of stale) byAsset.set(d.activeId, [...(byAsset.get(d.activeId) ?? []), d]);
  const requests: { activeId: number; days: DayVersion[] }[] = [];
  for (const [activeId, days] of byAsset) {
    days.sort((a, b) => a.day.localeCompare(b.day));
    let run: DayVersion[] = [];
    for (const d of days) {
      const previous = run.at(-1);
      const consecutive = previous !== undefined && Date.parse(d.day) - Date.parse(previous.day) === DAY_MS;
      if (run.length > 0 && (!consecutive || run.length >= DAYS_PER_REQUEST)) {
        requests.push({ activeId, days: run });
        run = [];
      }
      run.push(d);
    }
    if (run.length > 0) requests.push({ activeId, days: run });
  }
  return requests;
}
