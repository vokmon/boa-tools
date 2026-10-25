#!/usr/bin/env bun
import { join } from "node:path";
import { backtestResultsDir, backtestSettingsDir, dataDir, loadIqOptionEnv, loadTursoEnv } from "@/config/env";
import { createTursoClient } from "@/clients/turso/createTursoClient";
import { CandleDb } from "@/storage/CandleDb";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { chooseMany, defineCommand, isInteractive, UsageError } from "@/lib/cli";
import { Progress } from "@/lib/progress";
import { prepareData, useLocalCopy } from "./data/prepareData";
import { runBacktest } from "./runBacktest";
import { loadSettingsFolder, SettingsError, type RunSetting } from "./settings/settingsFile";
import { writeResultFiles } from "./output/writeFiles";
import { writeReport } from "./report/renderReport";
import { reversalEvidence } from "./evidence/reversalEvidence";
import { evidenceLines, writeEvidenceFiles } from "./evidence/evidenceOutput";

const SIZE = 60;
const ALL = "__all__";

defineCommand({
  name: "backtest",
  description: `
Replays the bot on all collected candles with the settings files you pick, and shows for each
setting how often rounds win, at which martingale level, the profit per day, the risk and the best
hours to trade.`,
  examples: [
    "bun run backtest                          pick settings files from a list",
    "bun run backtest --all                    every settings file",
    "bun run backtest --settings bot-current,my-idea",
    "bun run backtest --all --local            use the local copy as it is, without Turso or IQ Option",
    "bun run backtest --evidence --local       how often the next candle reverses after each piece of evidence",
  ],
  options: {
    all: { type: "boolean", description: "run every settings file without asking", default: false },
    settings: { type: "string", placeholder: "names", description: "settings files to run, comma separated (without .json)" },
    local: { type: "boolean", description: "skip updating Turso and the local copy; use the local copy as it is", default: false },
    evidence: { type: "boolean", description: "instead of settings: measure how often the next candle reverses after each piece of reversal evidence", default: false },
  },
  env: [
    { name: "IQ_OPTION_USER", description: "IQ Option login, to fetch candles (not needed with --local)" },
    { name: "IQ_OPTION_PASSWORD", description: "IQ Option password" },
    { name: "TURSO_DATABASE_URL", description: "Turso database with the candles, libsql://…turso.io (not needed with --local)" },
    { name: "TURSO_AUTH_TOKEN", description: "Turso token with read and write access" },
    { name: "BACKTEST_SETTINGS_DIR", description: "folder with settings files (*.json)", default: "backtest/settings" },
    { name: "BACKTEST_RESULTS_DIR", description: "folder for results, one subfolder per run", default: "<DATA_DIR>/backtest" },
    { name: "DATA_DIR", description: "folder for the local candles copy", default: "data" },
  ],
  notes: `
Every run first keeps the local copy (<DATA_DIR>/candles.sqlite) and Turso in sync (unless --local):
  1. IQ Option -> local copy + Turso: asset-days in neither place (local only when Turso's
     monthly write limit is used up)
  2. Turso -> local copy: days only Turso has
  3. local copy -> Turso: days only the local copy has, once Turso accepts writes again
then plays each setting at max martingale 0 to 4 on all finished days.

Each run writes to <BACKTEST_RESULTS_DIR>/<date_time>/:
  report.html (open it in a browser), results.json, ai-brief.md (paste into an AI for the next
  settings to try), settings/ (every setting as a settings file)
  With --evidence: evidence.md and evidence.json instead

Every setting and number explained: src/tools/backtest/docs/ (settings.md, results.md)`,
  run: async (values) => {
    if (values.evidence && (values.all || values.settings !== undefined)) throw new UsageError("--evidence does not use settings files; leave out --all and --settings");
    const settingsDir = backtestSettingsDir();
    let settings: RunSetting[] = [];
    const progress = new Progress();
    if (values.evidence) {
      progress.title("Reversal evidence");
    } else {
      let files: SettingsFiles;
      try {
        files = await loadSettingsFolder(settingsDir);
      } catch (error) {
        if (error instanceof SettingsError) throw new UsageError(error.message);
        throw error;
      }
      const chosen = await chooseSettings(files, values.all, values.settings);
      settings = chosen.flatMap((f) => f.settings);
      progress.title("Backtest");
      progress.task("📂", `${settings.length} setting(s) from ${settingsDir}: ${chosen.map((f) => f.file).join(", ")}`);
    }

    const cachePath = join(dataDir(), "candles.sqlite");
    // --local needs neither IQ Option nor Turso, so their .env values are not even read
    const turso = values.local ? undefined : createTursoClient(loadTursoEnv());
    const cache = new LocalCandleCache(cachePath);
    try {
      if (turso) await prepareData({ iqEnv: loadIqOptionEnv(), db: new CandleDb(turso), cache, cachePath, size: SIZE, now: new Date(), progress });
      else useLocalCopy({ cache, cachePath, size: SIZE, progress });
      if (values.evidence) return await runEvidence(cache, progress);

      progress.step("Signals & rounds");
      const assets = cache.assets().length;
      const task = progress.task("🧮", `${settings.length} setting(s) × ${assets} assets, each at max martingale 0-4`);
      const bar = task.bar(assets, "assets");
      const run = runBacktest(cache, settings, SIZE, () => bar.update());
      bar.end();
      const rounds = run.results.reduce((n, r) => n + r.summary.rounds, 0);
      task.done(`${rounds.toLocaleString("en-US")} rounds over ${run.period.days.length} days`);

      progress.step("Results");
      const dir = join(backtestResultsDir(), runFolderName(new Date()));
      const saved = progress.task("💾", "Saving");
      const written = await writeResultFiles(dir, run);
      const reportPath = await writeReport(dir, run);
      saved.done(`${dir}/ (${["report.html", ...written].join(", ")})`);
      console.log(`\n   📊 Report: ${reportPath}\n`);
    } finally {
      cache.close();
      turso?.close();
    }
  },
});

type SettingsFiles = { file: string; settings: RunSetting[] }[];

/** --evidence: every candle as a possible reversal, grouped by each piece of evidence. */
async function runEvidence(cache: LocalCandleCache, progress: Progress): Promise<void> {
  progress.step("Reversal evidence");
  const assets = cache.assets().length;
  const task = progress.task("🔎", `${assets} assets, every candle`);
  const bar = task.bar(assets, "assets");
  const run = reversalEvidence(cache, SIZE, () => bar.update());
  bar.end();
  task.done(`${run.candles.toLocaleString("en-US")} candles over ${run.period.days.length} days`);

  progress.step("Results");
  const dir = join(backtestResultsDir(), runFolderName(new Date()));
  const saved = progress.task("💾", "Saving");
  const written = await writeEvidenceFiles(dir, run);
  saved.done(`${dir}/ (${written.join(", ")})`);
  console.log(`\n${evidenceLines(run).join("\n")}\n`);
}

/** --all / --settings, or a picker with "All" on top. */
async function chooseSettings(files: SettingsFiles, all: boolean, names: string | undefined): Promise<SettingsFiles> {
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

/** 2026-10-22_153045 (Bangkok time) */
function runFolderName(now: Date): string {
  // Seconds too, so two runs in the same minute do not overwrite each other
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "");
}
