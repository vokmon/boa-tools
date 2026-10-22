import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeCsv } from "@/lib/csv/CsvWriter";
import type { BacktestResult, SettingResult } from "../runBacktest";
import { aiBrief } from "./aiBrief";
import { changesFromBot, finishedRounds, ordered, settingsFileJson } from "./format";

/** "try [bollinger.period=14]" -> "try_bollinger.period-14" */
function fileSafe(label: string): string {
  return label.replace(/[\[\]]/g, "").replace(/=/g, "-").replace(/[^\w.-]+/g, "_").replace(/_+$/, "");
}

/**
 * Writes the run's files into `dir`:
 * results.json (everything), results.csv (one row per setting), ai-brief.md (for an AI assistant),
 * settings/<setting>.json (each setting as a reusable settings file).
 */
export async function writeResultFiles(dir: string, run: BacktestResult): Promise<string[]> {
  await mkdir(join(dir, "settings"), { recursive: true });
  const rows = ordered(run.results);

  const json = {
    createdAt: new Date().toISOString(),
    period: { days: run.period.days.length, from: run.period.days[0], to: run.period.days.at(-1), timeZone: "Asia/Bangkok" },
    data: { assets: run.assets, candles: run.candles },
    settings: rows.map((r) => ({
      label: r.setting.label,
      file: r.setting.file,
      note: r.setting.note,
      changedFromBot: changesFromBot(r.setting.values),
      values: r.setting.values,
      worstCaseStake: r.worstCaseStake,
      summary: r.summary,
      byAsset: r.byAsset,
    })),
  };
  await Bun.write(join(dir, "results.json"), JSON.stringify(json, null, 1));

  const levels = Math.max(...rows.map((r) => r.setting.martingale.levels));
  await writeCsv<SettingResult>(join(dir, "results.csv"), rows, [
    { header: "setting", value: (r) => r.setting.label },
    { header: "changed_from_bot", value: (r) => changesFromBot(r.setting.values).join("; ") },
    { header: "rounds_per_day", value: (r) => r.summary.roundsPerDay.toFixed(1) },
    { header: "round_win_pct", value: (r) => r.summary.roundWinPct.toFixed(2) },
    ...Array.from({ length: levels + 1 }, (_, l) => ({ header: `won_at_L${l}_pct`, value: (r: SettingResult) => (((r.summary.wonAtLevel[l] ?? 0) / Math.max(1, finishedRounds(r))) * 100).toFixed(2) })),
    { header: "lost_all_pct", value: (r) => ((r.summary.lost / Math.max(1, finishedRounds(r))) * 100).toFixed(2) },
    { header: "profit_thb", value: (r) => r.summary.profit.toFixed(0) },
    { header: "profit_per_day_thb", value: (r) => r.summary.profitPerDay.toFixed(0) },
    { header: "losing_days", value: (r) => r.summary.losingDays },
    { header: "worst_day_thb", value: (r) => r.summary.worstDay?.profit.toFixed(0) ?? "" },
    { header: "biggest_drop_thb", value: (r) => r.summary.biggestDrop.toFixed(0) },
    { header: "most_at_once", value: (r) => r.summary.mostAtOnce },
    { header: "last_2_weeks_round_win_pct", value: (r) => r.summary.check.last.roundWinPct.toFixed(2) },
    { header: "last_2_weeks_held_up", value: (r) => (r.summary.check.heldUp ? "yes" : "no") },
    { header: "good_hours", value: (r) => r.summary.goodHours.join(" ") },
    { header: "avoid_hours", value: (r) => r.summary.avoidHours.join(" ") },
  ]);

  await Bun.write(join(dir, "ai-brief.md"), aiBrief(run));
  for (const r of rows) {
    await Bun.write(join(dir, "settings", `${fileSafe(r.setting.label)}.json`), JSON.stringify(settingsFileJson(r.setting.values, r.setting.note), null, 2) + "\n");
  }
  return ["results.json", "results.csv", "ai-brief.md", "settings/"];
}
