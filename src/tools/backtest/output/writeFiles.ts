import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BacktestResult } from "../runBacktest";
import { aiBrief } from "./aiBrief";
import { changesFromBot, ordered, settingsFileJson } from "./format";

/** "try [bollinger.period=14]" -> "try_bollinger.period-14" */
function fileSafe(label: string): string {
  return label.replace(/[\[\]]/g, "").replace(/=/g, "-").replace(/[^\w.-]+/g, "_").replace(/_+$/, "");
}

/**
 * Writes the run's files into `dir`:
 * results.json (everything), ai-brief.md (for an AI assistant),
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
  await Bun.write(join(dir, "ai-brief.md"), aiBrief(run));
  for (const r of rows) {
    await Bun.write(join(dir, "settings", `${fileSafe(r.setting.label)}.json`), JSON.stringify(settingsFileJson(r.setting.values, r.setting.note), null, 2) + "\n");
  }
  return ["results.json", "ai-brief.md", "settings/"];
}
