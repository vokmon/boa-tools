import { describe, expect, test } from "bun:test";
import { bangkokPeriod } from "@/tools/backtest/runBacktest";
import { changesFromBot, fullLossEvery, money, settingsFileJson, share } from "@/tools/backtest/output/format";
import { parseSettingsFile } from "@/tools/backtest/settings/settingsFile";

describe("bangkokPeriod", () => {
  test("only full Bangkok days inside the UTC data", () => {
    const period = bangkokPeriod(["2026-10-18", "2026-10-19", "2026-10-20"]);
    // UTC data covers 18/10 07:00 to 21/10 07:00 Bangkok
    expect(period.days).toEqual(["2026-10-19", "2026-10-20"]);
    expect(new Date(period.from * 1000).toISOString()).toBe("2026-10-18T17:00:00.000Z");
    expect(new Date(period.to * 1000).toISOString()).toBe("2026-10-20T17:00:00.000Z");
  });
});

describe("format", () => {
  test("money, shares and full-loss frequency", () => {
    expect([money(1240.5), money(-95.2), money(0)]).toEqual(["+1,241", "-95", "0"]);
    expect([share(51, 100), share(1, 300), share(0, 10)]).toEqual(["51%", "<1%", "0%"]);
    expect([fullLossEvery(4.2), fullLossEvery(0.04), fullLossEvery(null)]).toEqual(["1 per 4.2 days", "25.0 per day", "never"]);
  });

  test("a tested setting is saved as a full settings file, like bot-current.json", async () => {
    const [s] = parseSettingsFile("x", { stochastic: { level: 90 }, hours: ["07-11"], note: "try" });
    expect(changesFromBot(s!.values)).toEqual(["stochastic.level 85→90", "hours 07-11"]);
    const saved = settingsFileJson(s!.values, s!.note);
    const botCurrent = await Bun.file("backtest/settings/bot-current.json").json();
    expect(Object.keys(saved)).toEqual([...Object.keys(botCurrent), "hours"]);
    expect(saved.stochastic).toEqual({ ...botCurrent.stochastic, level: 90 });
    // Saved files load back to the same setting
    const [again] = parseSettingsFile("x", settingsFileJson(s!.values, s!.note));
    expect(again!.signal).toEqual(s!.signal);
  });
});
