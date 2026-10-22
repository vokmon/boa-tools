import { describe, expect, test } from "bun:test";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { runBacktest } from "@/tools/backtest/runBacktest";
import { parseSettingsFile } from "@/tools/backtest/settings/settingsFile";
import { renderReport } from "@/tools/backtest/report/renderReport";
import { RESULT_GUIDE, SETTING_GROUPS, SETTING_GUIDE } from "@/tools/backtest/report/guide";
import { NUMBER_FIELDS } from "@/tools/backtest/settings/fields";
import { syntheticCache } from "./helpers/syntheticCache";

describe("guide", () => {
  test("the docs repeat every explanation word for word", async () => {
    const readme = (await Bun.file("src/tools/backtest/docs/results.md").text()) + (await Bun.file("src/tools/backtest/docs/settings.md").text());
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
    const settings = [
      ...parseSettingsFile("bot-current", {}),
      ...parseSettingsFile("x", { note: "</script><b>hi</b>", stochastic: { level: 90 }, martingale: { multiplier: [2.5, 2.2] } }),
    ];
    const run = runBacktest(cache, settings, 60);
    cache.close();

    const html = await renderReport(run);
    expect(html).not.toContain("__REPORT_DATA__");
    expect(html).not.toContain("</script><b>");
    const json = /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!;
    const data = JSON.parse(json);
    // The two multipliers of "x" are one signal, switched in the page
    expect(data.settings.map((s: { label: string }) => s.label)).toEqual(["bot-current", "x"]);
    expect(data.settings[1].note).toBe("</script><b>hi</b>");
    expect(data.settings[1].changes).toEqual(["stochastic.level 85→90"]);
    expect(Object.keys(data.settings[1].views).sort()).toEqual(["2.2", "2.5"]);
    expect(Object.keys(data.settings[0].views["2.5"])).toEqual(["total", "main", "otc"]);
    expect(Object.keys(data.settings[0].views["2.5"].total)).toEqual(["0", "1", "2", "3", "4"]);
    expect(data.settings[0].views["2.5"].total["2"].summary.hours).toHaveLength(24);
    expect(data.multiplierOptions).toEqual([2.5, 2.2]);
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
    const barButtons: Record<string, () => void> = {};
    const tabs = () =>
      [...elements.app!.innerHTML.matchAll(/data-tab="(\d+)"/g)].map((m) => ({
        dataset: { tab: m[1] },
        classList: { toggle: () => {} },
        addEventListener: (_: string, fn: () => void) => handlers.push(fn),
      }));
    const bar = () =>
      [...elements.app!.innerHTML.matchAll(/class="lvl[^"]*" data-key="(\w+)" data-value="([\w.]+)"/g)].map((m) => ({
        dataset: { key: m[1], value: m[2] },
        addEventListener: (_: string, fn: () => void) => (barButtons[`${m[1]}=${m[2]}`] = fn),
      }));
    const document = {
      getElementById: (id: string) => elements[id],
      querySelectorAll: (selector: string) => (selector === ".tab" ? tabs() : selector === ".lvl" ? bar() : []),
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

    // The bar: assets x multiplier x max martingale, each button redraws the page for that view
    expect(Object.keys(barButtons).sort()).toEqual(["group=main", "group=otc", "group=total", "level=0", "level=1", "level=2", "level=3", "level=4", "multiplier=2.5"]);
    for (const [button, shown] of [["group=otc", "OTC · x2.5 · max martingale 4"], ["level=0", "OTC · x2.5 · no martingale"], ["group=main", "Main · x2.5 · no martingale"], ["level=3", "Main · x2.5 · max martingale 3"]] as const) {
      barButtons[button]!();
      panels.push(elements.detail!.innerHTML);
      expect(elements.app!.innerHTML).toContain(shown);
      expect(elements.detail!.innerHTML).toContain("Weekend day");
      expect(elements.detail!.innerHTML).toContain("Week by week");
    }
    for (const out of [elements.app!.innerHTML, ...panels]) {
      expect(out).not.toMatch(/undefined|NaN/);
    }
  });
});
