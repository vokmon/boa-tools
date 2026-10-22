import type { IqOptionEnv } from "@/config/env";
import type { CandleDb } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { firstFullDay, type CollectSummary } from "@/tools/shared/candles/CandleCollector";
import { collectFromBroker, type CollectReport } from "@/tools/shared/candles/collectFromBroker";
import { buildPeriod } from "@/lib/date";
import { compactNumber, shortDay, type Bar, type Progress, type Task } from "@/lib/progress";
import { CandleSync, type SyncSummary } from "./CandleSync";

/** yyyy-mm-dd -> dd/mm/yyyy */
const toDmy = (key: string) => key.split("-").reverse().join("/");

/**
 * Gets the data ready before every backtest:
 * 1. brings Turso up to date from IQ Option: every day the broker still has, up to now (today's
 *    candles so far included); complete asset-days are skipped, so only today and anything missed
 *    are fetched,
 * 2. copies new or changed complete days from Turso into the local cache (the backtest uses
 *    complete days only).
 */
export async function prepareData(input: {
  iqEnv: IqOptionEnv;
  db: CandleDb;
  cache: LocalCandleCache;
  cachePath: string;
  size: number;
  now: Date;
  progress: Progress;
}): Promise<{ collect: CollectSummary; sync: SyncSummary }> {
  const { db, cache, size, now, progress } = input;
  const today = now.toISOString().slice(0, 10);
  const days = buildPeriod(toDmy(firstFullDay(now, size)), toDmy(today), "UTC").days.map((d) => d.key);

  progress.step("Data");

  const turso = progress.task("☁️ ", "Turso, from IQ Option");
  const { summary: collect } = await collectFromBroker({ iqEnv: input.iqEnv, db, days, size, force: false, now, report: collectReport(turso, days.length) });
  const upTo = `up to date to ${bangkokTime(now)} (Bangkok)`;
  if (collect.failed.length) turso.fail(`${collect.failed.length} asset-days failed, retried next run; otherwise ${upTo}`);
  // Candles already stored are kept as they are, so "fetched" includes today's earlier minutes
  else turso.done(`${upTo} · ${compactNumber(collect.candles)} candles fetched`);

  const local = progress.task("🔄", "Local copy");
  let bar: Bar | undefined;
  const sync = await new CandleSync(db, cache).sync(size, {
    start: (assetDays, requests) => {
      local.info("📥", `${assetDays.toLocaleString("en-US")} new or changed asset-days in Turso`);
      bar = local.bar(requests, "requests");
    },
    request: () => bar?.update(),
  });
  bar?.end();
  local.done(sync.copied === 0 ? "Already up to date" : `Copied ${sync.copied.toLocaleString("en-US")} asset-days · ${compactNumber(sync.candles)} candles`);
  local.info("💾", localCopyLine(cache, input.cachePath, size));
  return { collect, sync };
}

/** --local: no Turso or IQ Option, the local copy as it is. */
export function useLocalCopy(input: { cache: LocalCandleCache; cachePath: string; size: number; progress: Progress }): void {
  input.progress.step("Data");
  const local = input.progress.task("💾", "Local copy only (--local): Turso and IQ Option are not updated");
  local.done(localCopyLine(input.cache, input.cachePath, input.size));
}

function localCopyLine(cache: LocalCandleCache, cachePath: string, size: number): string {
  const held = cache.days(size);
  return `${cachePath} · ${cache.assets().length} assets · ${held.length} days (${shortDay(held[0] ?? "")} → ${shortDay(held.at(-1) ?? "")})`;
}

/** "22/10 14:58" in Bangkok time (UTC+7, no daylight saving). */
function bangkokTime(now: Date): string {
  const t = new Date(now.getTime() + 7 * 3_600_000).toISOString();
  return `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`;
}

/** Collector progress as task details: login, asset list, a bar over the days, failures. */
function collectReport(task: Task, totalDays: number): CollectReport {
  let bar: Bar | undefined;
  return {
    loggedIn: () => task.info("🔐", "Logged in to IQ Option"),
    assetList: (assets, days) => {
      task.info("📋", `${assets.length} assets · ${days.length} days (${shortDay(days[0]!)} → ${shortDay(days.at(-1)!)})`);
      bar = task.bar(totalDays, "days");
    },
    day: (r) => {
      // Today is fetched on every run; only report it, and older days, when something was added
      if (r.fetched > 0 && r.candles > 0) task.info(r.status === "partial" ? "🕐" : "➕", `${shortDay(r.day)}${r.status === "partial" ? " (so far)" : ""}: ${r.fetched} assets · ${compactNumber(r.candles)} candles`);
      bar?.update();
    },
    failed: (day, asset, message) => task.warn(`${shortDay(day)} ${asset}: ${message}`),
    beyondHistory: (days) => task.info("⏭️ ", `${days.length} day(s) older than the broker keeps, skipped`),
  };
}
