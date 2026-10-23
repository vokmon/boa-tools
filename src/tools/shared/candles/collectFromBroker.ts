import type { IqOptionEnv } from "@/config/env";
import { connectIqOption } from "@/clients/iqoption/connectIqOption";
import { CandlesService } from "@/clients/iqoption/CandlesService";
import { UnderlyingsService } from "@/clients/iqoption/UnderlyingsService";
import type { CandleDb, StoredAsset } from "@/storage/CandleDb";
import { logger } from "@/lib/logger";
import { CandleCollector, lineEvents, type CollectEvents, type CollectSummary } from "./CandleCollector";

/** Where collected candles go: Turso itself (collect-candles), or Turso and the local copy (backtest). */
export type CandleStore = Pick<CandleDb, "upsertAssets" | "listAssets" | "completeDays" | "saveDay">;

export interface CollectFromBrokerInput {
  iqEnv: IqOptionEnv;
  db: CandleStore;
  /** UTC days, yyyy-mm-dd. */
  days: readonly string[];
  size: number;
  force: boolean;
  now: Date;
  /** How progress is shown; default: log lines, as collect-candles prints them. */
  report?: CollectReport;
}

/** Progress of a whole collection: the steps around the per-day events. */
export interface CollectReport extends CollectEvents {
  loggedIn(): void;
  assetList(assets: readonly StoredAsset[], days: readonly string[]): void;
  beyondHistory(days: readonly string[]): void;
}

const logReport: CollectReport = {
  ...lineEvents,
  loggedIn: () => {},
  assetList: (assets, days) => {
    const otc = assets.filter((a) => a.isOtc).length;
    logger.info(`${assets.length} assets (${otc} OTC, ${assets.length - otc} main), ${days.length} UTC days ${days[0]} to ${days.at(-1)}`);
  },
  beyondHistory: (days) => logger.warn(`${days.length} day(s) are older than the broker's history and were skipped: ${days[0]} to ${days.at(-1)}`),
};

/**
 * Logs in to IQ Option, refreshes the asset list (everything scheduled in the next week plus every
 * asset seen before) and collects the given days into Turso. Used by collect-candles and backtest.
 */
export async function collectFromBroker(input: CollectFromBrokerInput): Promise<{ assets: StoredAsset[]; summary: CollectSummary }> {
  const { db, days, size, now } = input;
  const report = input.report ?? logReport;
  if (!input.report) logger.info("Logging in to IQ Option...");
  const sdk = await connectIqOption(input.iqEnv);
  report.loggedIn();
  try {
    const scheduled = await new UnderlyingsService(await sdk.digitalOptions(), await sdk.actives()).listScheduled(sdk.currentTime());
    await db.upsertAssets(scheduled, now);
    // Assets seen on earlier runs stay in the list even if the broker no longer schedules them
    const assets = await db.listAssets();
    report.assetList(assets, days);

    const collector = new CandleCollector(db, new CandlesService(await sdk.candles()), report);
    const summary = await collector.collect({ assets, days, size, force: input.force, now });
    if (summary.beyondHistory.length) report.beyondHistory(summary.beyondHistory);
    return { assets, summary };
  } finally {
    sdk.shutdown();
  }
}
