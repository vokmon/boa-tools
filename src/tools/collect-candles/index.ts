#!/usr/bin/env bun
import { join } from "node:path";
import { dataDir, loadIqOptionEnv } from "@/config/env";
import { connectIqOption } from "@/clients/iqoption/connectIqOption";
import { CandlesService } from "@/clients/iqoption/CandlesService";
import { UnderlyingsService } from "@/clients/iqoption/UnderlyingsService";
import { CandleStore } from "@/storage/CandleStore";
import { buildPeriod } from "@/lib/date";
import { defineCommand } from "@/lib/cli";
import { resolveDateRange } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { CandleCollector, firstFullDay } from "./CandleCollector";

const SIZE = 60;

/** yyyy-mm-dd -> dd/mm/yyyy */
const toDmy = (key: string) => key.split("-").reverse().join("/");

defineCommand({
  name: "collect-candles",
  description: `
Downloads 1-minute candles for every digital-options asset (OTC and main) into
<DATA_DIR>/candles.sqlite, one UTC day at a time. Days already collected are skipped, so run it as often as you like.`,
  examples: [
    "bun run collect-candles                                   asks for the days",
    "bun run collect-candles --from 22/08/2026 --to 20/10/2026",
    "bun run collect-candles --from 20/10/2026 --to 20/10/2026 --force",
  ],
  options: {
    from: { type: "string", placeholder: "dd/mm/yyyy", description: "first UTC day (default: oldest day the broker still has in full)" },
    to: { type: "string", placeholder: "dd/mm/yyyy", description: "last UTC day, inclusive (default today, stored as partial)" },
    force: { type: "boolean", description: "fetch days again even if already collected", default: false },
  },
  notes: `
The broker keeps only about 60 days of 1-minute candles, so run this at least every few weeks or
older days are lost. Today and the oldest edge day are stored as partial and fetched again next run.`,
  run: async (values) => {
    const env = loadIqOptionEnv();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const { from, to } = await resolveDateRange({
      from: values.from,
      to: values.to,
      defaultFrom: toDmy(firstFullDay(now, SIZE)),
      defaultTo: toDmy(today),
      fromDefaultsWithoutTerminal: true,
    });
    const days = buildPeriod(from, to, "UTC").days.map((d) => d.key);

    const dbPath = join(dataDir(), "candles.sqlite");
    const store = new CandleStore(dbPath);
    logger.info("Logging in to IQ Option...");
    const sdk = await connectIqOption(env);
    try {
      const underlyings = new UnderlyingsService(await sdk.digitalOptions(), await sdk.actives());
      const scheduled = await underlyings.listScheduled(sdk.currentTime());
      store.upsertAssets(scheduled, now);
      // Assets seen on earlier runs stay in the list even if the broker no longer schedules them
      const assets = store.listAssets();
      const otc = assets.filter((a) => a.isOtc).length;
      logger.info(`${assets.length} assets (${otc} OTC, ${assets.length - otc} main), ${days.length} UTC days ${from} to ${to}, db ${dbPath}`);

      const collector = new CandleCollector(store, new CandlesService(await sdk.candles()));
      const summary = await collector.collect({ assets, days, size: SIZE, force: values.force, now });

      if (summary.beyondHistory.length) {
        logger.warn(`${summary.beyondHistory.length} day(s) are older than the broker's history and were skipped: ${summary.beyondHistory[0]} to ${summary.beyondHistory.at(-1)}`);
      }
      console.log(
        `\nFetched ${summary.fetched} asset-days (${summary.partial} partial), skipped ${summary.skipped} already collected, ` +
          `${summary.candles.toLocaleString("en-US")} candles written.`,
      );
      if (summary.failed.length) {
        console.log(`${summary.failed.length} asset-day(s) failed and will be retried next run:`);
        for (const f of summary.failed.slice(0, 20)) console.log(`  ${f}`);
        process.exitCode = 1;
      }
    } finally {
      sdk.shutdown();
      store.close();
    }
  },
});
