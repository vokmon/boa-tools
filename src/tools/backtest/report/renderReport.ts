import { join } from "node:path";
import type { BacktestResult } from "../runBacktest";
import { reportData } from "./reportData";

const PLACEHOLDER = "__REPORT_DATA__";

/**
 * report.html: the fixed template (same layout every run) with this run's data embedded as JSON,
 * so the file is self-contained and opens anywhere without a server or internet.
 */
export async function renderReport(run: BacktestResult): Promise<string> {
  const template = await Bun.file(new URL("./template.html", import.meta.url)).text();
  if (!template.includes(PLACEHOLDER)) throw new Error("report template has no data placeholder");
  // "<" escaped so text in the data can never close the script tag
  const json = JSON.stringify(reportData(run)).replace(/</g, "\\u003c");
  return template.replace(PLACEHOLDER, () => json);
}

export async function writeReport(dir: string, run: BacktestResult): Promise<string> {
  const path = join(dir, "report.html");
  await Bun.write(path, await renderReport(run));
  return path;
}
