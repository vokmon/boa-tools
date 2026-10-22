#!/usr/bin/env bun
import { join } from "node:path";
import { backtestResultsDir, backtestSettingsDir, dataDir, loadIqOptionEnv, loadTursoEnv } from "@/config/env";
import { createTursoClient } from "@/clients/turso/createTursoClient";
import { CandleDb } from "@/storage/CandleDb";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { chooseMany, defineCommand, isInteractive, UsageError } from "@/lib/cli";
import { Progress } from "@/lib/progress";
import { prepareData } from "./data/prepareData";
import { runBacktest } from "./runBacktest";
import { loadSettingsFolder, SettingsError, type RunSetting } from "./settings/settingsFile";
import { resultLines } from "./output/terminal";
import { writeResultFiles } from "./output/writeFiles";

const SIZE = 60;
const ALL = "__all__";

defineCommand({
  name: "backtest",
  description: `
Replays the bot on all collected candles with the settings files you pick, and shows for each
setting how often rounds win, at which martingale level, the profit per day, the risk and the best
hours to trade. Settings files live in BACKTEST_SETTINGS_DIR (default backtest/settings).`,
  examples: [
    "bun run backtest                          pick settings files from a list",
    "bun run backtest --all                    every settings file",
    "bun run backtest --settings bot-current,stochastic-90",
  ],
  options: {
    all: { type: "boolean", description: "run every settings file without asking", default: false },
    settings: { type: "string", placeholder: "names", description: "settings files to run, comma separated (without .json)" },
  },
  notes: `
Before running it fills missing candles in Turso from IQ Option and updates the local copy in
DATA_DIR. Results go to BACKTEST_RESULTS_DIR/<date_time>/: results.json, results.csv, ai-brief.md
(paste it into an AI to get the next settings to try) and each setting as a settings file.
See src/tools/backtest/README.md for what every setting and number means.`,
  run: async (values) => {
    const settingsDir = backtestSettingsDir();
    let files: Awaited<ReturnType<typeof loadSettingsFolder>>;
    try {
      files = await loadSettingsFolder(settingsDir);
    } catch (error) {
      if (error instanceof SettingsError) throw new UsageError(error.message);
      throw error;
    }
    const chosen = await chooseSettings(files, values.all, values.settings);
    const settings = chosen.flatMap((f) => f.settings);

    const progress = new Progress();
    progress.title("Backtest");
    progress.task("📂", `${settings.length} setting(s) from ${settingsDir}: ${chosen.map((f) => f.file).join(", ")}`);

    const iqEnv = loadIqOptionEnv();
    const turso = createTursoClient(loadTursoEnv());
    const cachePath = join(dataDir(), "candles.sqlite");
    const cache = new LocalCandleCache(cachePath);
    try {
      await prepareData({ iqEnv, db: new CandleDb(turso), cache, cachePath, size: SIZE, now: new Date(), progress });

      progress.step("Signals & rounds");
      const assets = cache.assets().length;
      const task = progress.task("🧮", `${settings.length} setting(s) × ${assets} assets`);
      const bar = task.bar(assets, "assets");
      const run = runBacktest(cache, settings, SIZE, () => bar.update());
      bar.end();
      const rounds = run.results.reduce((n, r) => n + r.summary.rounds, 0);
      task.done(`${rounds.toLocaleString("en-US")} rounds over ${run.period.days.length} days`);

      progress.step("Results");
      const dir = join(backtestResultsDir(), runFolderName(new Date()));
      const saved = progress.task("💾", "Saving");
      const written = await writeResultFiles(dir, run);
      saved.done(`${dir}/ (${written.join(", ")})`);
      console.log(`\n${resultLines(run).join("\n")}\n`);
      console.log(`   🤖 Next settings to try: paste ${join(dir, "ai-brief.md")} into an AI, save its files in ${settingsDir}\n`);
    } finally {
      cache.close();
      turso.close();
    }
  },
});

/** --settings names, --all, or a picker with "All" on top. */
async function chooseSettings(files: { file: string; settings: RunSetting[] }[], all: boolean, names: string | undefined): Promise<typeof files> {
  if (all) return files;
  if (names !== undefined) {
    const wanted = names.split(",").map((n) => n.trim().replace(/\.json$/, "")).filter(Boolean);
    const unknown = wanted.filter((n) => !files.some((f) => f.file === n));
    if (unknown.length || wanted.length === 0) throw new UsageError(`unknown settings file(s): ${unknown.join(", ") || "none given"}. Available: ${files.map((f) => f.file).join(", ")}`);
    return files.filter((f) => wanted.includes(f.file));
  }
  if (!isInteractive()) throw new UsageError("use --all or --settings <names> when not running in a terminal");
  const picked = await chooseMany("What do you want to run?", [
    { name: "All", value: ALL },
    ...files.map((f) => ({
      name: f.settings.length > 1 ? `${f.file}  (${f.settings.length} combinations)` : f.file,
      value: f.file,
      description: f.settings[0]?.note,
    })),
  ]);
  return picked.includes(ALL) ? files : files.filter((f) => picked.includes(f.file));
}

/** 2026-10-22_1530 (Bangkok time) */
function runFolderName(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", "_").replace(":", "");
}
