import type { IqOptionEnv } from "@/config/env";
import type { CandleDb } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { firstFullDay } from "@/tools/shared/candles/CandleCollector";
import { collectFromBroker, type CollectReport } from "@/tools/shared/candles/collectFromBroker";
import { buildPeriod } from "@/lib/date";
import { compactNumber, shortDay, type Bar, type Progress, type Task } from "@/lib/progress";
import { CandleSync } from "./CandleSync";
import { MirroredStore } from "./MirroredStore";
import { backfillTurso } from "./backfillTurso";

/** yyyy-mm-dd -> dd/mm/yyyy */
const toDmy = (key: string) => key.split("-").reverse().join("/");

/**
 * Gets the data ready before every backtest, keeping the local copy and Turso in sync as far as
 * Turso allows:
 * 1. IQ Option -> local copy + Turso: asset-days in neither place are fetched (every day the broker
 *    still has, up to now; today's candles so far go to Turso only). Saved locally first; once Turso
 *    refuses writes (its monthly limit) the rest go to the local copy only,
 * 2. Turso -> local copy: days only Turso has (e.g. from the daily Supabase job), or changed there,
 * 3. local copy -> Turso: days only the local copy has (saved while Turso refused writes), oldest
 *    first, until Turso refuses again.
 */
export async function prepareData(input: {
  iqEnv: IqOptionEnv;
  db: CandleDb;
  cache: LocalCandleCache;
  cachePath: string;
  size: number;
  now: Date;
  progress: Progress;
}): Promise<void> {
  const { db, cache, size, now, progress } = input;
  const today = now.toISOString().slice(0, 10);
  const days = buildPeriod(toDmy(firstFullDay(now, size)), toDmy(today), "UTC").days.map((d) => d.key);

  progress.step("Data");

  // 1. IQ Option -> local copy + Turso
  const fetch = progress.task("📥", "1/3 IQ Option → local copy + Turso");
  const store = new MirroredStore(db, cache);
  const { summary: collect } = await collectFromBroker({ iqEnv: input.iqEnv, db: store, days, size, force: false, now, report: collectReport(fetch, days.length) });
  if (store.tursoBlocked) fetch.warn(`Turso's monthly write limit is reached: ${store.localOnly.toLocaleString("en-US")} asset-days saved to the local copy only, copied to Turso on a later run`);
  const upTo = `up to date to ${bangkokTime(now)} (Bangkok)`;
  if (collect.failed.length) fetch.fail(`${collect.failed.length} asset-days failed, retried next run; otherwise ${upTo}`);
  // Candles already stored are kept as they are, so "fetched" includes today's earlier minutes
  else fetch.done(`${upTo} · ${compactNumber(collect.candles)} candles fetched`);

  // 2. Turso -> local copy
  const toLocal = progress.task("☁️ ", "2/3 Turso → local copy");
  let bar: Bar | undefined;
  const sync = await new CandleSync(db, cache).sync(size, {
    start: (assetDays, requests) => {
      toLocal.info("📥", `${assetDays.toLocaleString("en-US")} asset-days only in Turso, or changed there`);
      bar = toLocal.bar(requests, "requests");
    },
    request: () => bar?.update(),
  });
  bar?.end();
  toLocal.done(sync.copied === 0 ? "Already in sync" : `Copied ${sync.copied.toLocaleString("en-US")} asset-days · ${compactNumber(sync.candles)} candles`);

  // 3. local copy -> Turso
  const toTurso = progress.task("💾", "3/3 Local copy → Turso");
  if (store.tursoBlocked) {
    toTurso.warn("Skipped: Turso refuses writes until its limit resets (the 1st of the month)");
  } else {
    let days: Bar | undefined;
    const backfill = await backfillTurso(db, cache, size, {
      start: (assetDays) => {
        toTurso.info("📤", `${assetDays.toLocaleString("en-US")} asset-days only in the local copy`);
        days = toTurso.bar(assetDays, "asset-days");
      },
      day: () => days?.update(),
    });
    days?.end();
    if (backfill.blocked) toTurso.warn(`Turso's monthly write limit is reached: ${(backfill.missing - backfill.copied).toLocaleString("en-US")} asset-days wait for a later run`);
    toTurso.done(backfill.missing === 0 ? "Already in sync" : `Copied ${backfill.copied.toLocaleString("en-US")} of ${backfill.missing.toLocaleString("en-US")} asset-days · ${compactNumber(backfill.candles)} candles`);
  }
  const held = cache.days(size);
  progress.task("💾", localCopyLine(cache, input.cachePath, size)).done(`${held.length} days ready for the backtest`);
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
