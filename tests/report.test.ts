import { describe, expect, test } from "bun:test";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { runBacktest } from "@/tools/backtest/runBacktest";
import { parseSettingsFile } from "@/tools/backtest/settings/settingsFile";
import { renderReport } from "@/tools/backtest/report/renderReport";
import { RESULT_GUIDE, SETTING_GROUPS, SETTING_GUIDE } from "@/tools/backtest/report/guide";
import { NUMBER_FIELDS } from "@/tools/backtest/settings/fields";
import { syntheticCache } from "./helpers/syntheticCache";

describe("guide", () => {
  test("the README repeats every explanation word for word", async () => {
    const readme = await Bun.file("src/tools/backtest/README.md").text();
    const texts = [
      ...RESULT_GUIDE.map((g) => g.text),
      ...SETTING_GROUPS.map((g) => g.about),
      ...Object.values(SETTING_GUIDE).flatMap((e) => [e.text, e.higher].filter(Boolean)),
    ];
    expect(texts.filter((t) => !readme.includes(t))).toEqual([]);
  });

  test("every setting a file can set is explained", () => {
    expect(NUMBER_FIELDS.map((f) => f.path).filter((p) => !SETTING_GUIDE[p])).toEqual([]);
  });
});

describe("renderReport", () => {
  test("the template gets this run's data, safely embedded", async () => {
    const cache = new LocalCandleCache(await syntheticCache());
    const settings = [...parseSettingsFile("bot-current", {}), ...parseSettingsFile("x", { note: "</script><b>hi</b>", stochastic: { level: 90 } })];
    const run = runBacktest(cache, settings, 60);
    cache.close();

    const html = await renderReport(run);
    expect(html).not.toContain("__REPORT_DATA__");
    expect(html).not.toContain("</script><b>");
    const json = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    const data = JSON.parse(json);
    expect(data.settings.map((s: { label: string }) => s.label)).toEqual(["bot-current", "x"]);
    expect(data.settings[1].note).toBe("</script><b>hi</b>");
    expect(data.settings[1].changes).toEqual(["stochastic.level 85→90"]);
    expect(Object.keys(data.settings[0].views)).toEqual(["0", "1", "2", "3", "4"]);
    expect(data.settings[0].views["2"].summary.hours).toHaveLength(24);
    expect(data.levelOptions).toEqual([0, 1, 2, 3, 4]);
    expect(data.guide.results.length).toBe(RESULT_GUIDE.length);
  });
});

describe("report page script", () => {
  test("draws the page and every setting's tab without errors", async () => {
    const cache = new LocalCandleCache(await syntheticCache());
    const settings = [...parseSettingsFile("bot-current", {}), ...parseSettingsFile("x", { stochastic: { level: [80, 90] } })];
    const run = runBacktest(cache, settings, 60);
    cache.close();
    const html = await renderReport(run);

    // A minimal stand-in for the browser: the elements the script uses, and its tab buttons
    const json = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
    const elements: Record<string, { textContent?: string; innerHTML: string }> = { "report-data": { textContent: json, innerHTML: "" }, app: { innerHTML: "" }, detail: { innerHTML: "" } };
    const handlers: (() => void)[] = [];
    const levelButtons: Record<string, () => void> = {};
    const tabs = () =>
      [...elements.app!.innerHTML.matchAll(/data-tab="(\d+)"/g)].map((m) => ({
        dataset: { tab: m[1] },
        classList: { toggle: () => {} },
        addEventListener: (_: string, fn: () => void) => handlers.push(fn),
      }));
    const levels = () =>
      [...elements.app!.innerHTML.matchAll(/class="lvl[^"]*" data-level="(\w+)"/g)].map((m) => ({
        dataset: { level: m[1] },
        addEventListener: (_: string, fn: () => void) => (levelButtons[m[1]!] = fn),
      }));
    const document = {
      getElementById: (id: string) => elements[id],
      querySelectorAll: (selector: string) => (selector === ".tab" ? tabs() : selector === ".lvl" ? levels() : []),
    };
    new Function("document", script)(document);

    expect(elements.app!.innerHTML).toContain("Compare");
    const panels = [elements.detail!.innerHTML];
    // Click every tab (the handlers of the last tabs() call are the live ones)
    for (const click of handlers.slice(-settings.length)) {
      click();
      panels.push(elements.detail!.innerHTML);
    }
    for (const panel of panels) {
      expect(panel).toContain("How rounds end");
      expect(panel).toContain("Money and risk");
    }
    expect(new Set(panels.slice(1)).size).toBe(3);

    // The max martingale switch: every level redraws the page for that level
    expect(Object.keys(levelButtons).sort()).toEqual(["0", "1", "2", "3", "4", "own"]);
    for (const value of ["0", "1", "2", "3", "4", "own"]) {
      levelButtons[value]!();
      panels.push(elements.detail!.innerHTML);
      expect(elements.app!.innerHTML).toContain(value === "own" ? "showing each setting at its own max martingale" : `showing every setting at ${value === "0" ? "no martingale" : `max martingale ${value}`}`);
      expect(elements.detail!.innerHTML).toContain("How rounds end");
    }
    for (const out of [elements.app!.innerHTML, ...panels]) {
      expect(out).not.toMatch(/undefined|NaN/);
    }
  });
});
