import type { IqOptionEnv } from "@/config/env";
import type { CandleDb } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { firstFullDay, type CollectSummary } from "@/tools/shared/candles/CandleCollector";
import { collectFromBroker, type CollectReport } from "@/tools/shared/candles/collectFromBroker";
import { buildPeriod } from "@/lib/date";
import { compactNumber, shortDay, type Bar, type Progress, type Task } from "@/lib/progress";
import { CandleSync, type SyncSummary } from "./CandleSync";

const DAY_MS = 86_400_000;

/** yyyy-mm-dd -> dd/mm/yyyy */
const toDmy = (key: string) => key.split("-").reverse().join("/");

/**
 * Gets the data ready before every backtest:
 * 1. fills missing days in Turso from the broker (everything it still has, up to yesterday;
 *    complete asset-days are skipped, so this is quick unless something was missed),
 * 2. copies new or changed complete days from Turso into the local cache.
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
  const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
  const days = buildPeriod(toDmy(firstFullDay(now, size)), toDmy(yesterday), "UTC").days.map((d) => d.key);

  progress.step("Data");

  const missing = progress.task("🔍", "Missing candles");
  const { summary: collect } = await collectFromBroker({ iqEnv: input.iqEnv, db, days, size, force: false, now, report: collectReport(missing, days.length) });
  if (collect.fetched === 0 && collect.failed.length === 0) missing.done("Nothing missing");
  else if (collect.failed.length === 0) missing.done(`Filled ${collect.fetched.toLocaleString("en-US")} asset-days · ${compactNumber(collect.candles)} candles`);
  else missing.fail(`${collect.failed.length} asset-days failed (left out of this run)`);

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
  const held = cache.days(size);
  local.info("💾", `${input.cachePath} · ${cache.assets().length} assets · ${held.length} days (${shortDay(held[0] ?? "")} → ${shortDay(held.at(-1) ?? "")})`);
  return { collect, sync };
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
      if (r.fetched > 0) task.info("➕", `${shortDay(r.day)}: filled ${r.fetched} assets · ${compactNumber(r.candles)} candles`);
      bar?.update();
    },
    failed: (day, asset, message) => task.warn(`${shortDay(day)} ${asset}: ${message}`),
    beyondHistory: (days) => task.info("⏭️ ", `${days.length} day(s) older than the broker keeps, skipped`),
  };
}
