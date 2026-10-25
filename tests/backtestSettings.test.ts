import { describe, expect, test } from "bun:test";
import { TEST_SESSIONS } from "./helpers/sessions";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SIGNAL_SETTINGS } from "@/domain/signal";
import { loadSettingsFolder, parseHours, parseSettingsFile } from "@/tools/backtest/settings/settingsFile";

describe("parseSettingsFile", () => {
  test("an empty file is the bot's current settings, 4 martingale levels", () => {
    const [s] = parseSettingsFile("bot-current", { sessions: TEST_SESSIONS });
    expect(s!.signal).toEqual(DEFAULT_SIGNAL_SETTINGS);
    expect(s!.martingale).toEqual({ type: "standard", multiplier: 2.5, levels: 4 });
    expect(s!.order).toEqual({ amount: 30, payout: 85 });
    expect(s!.label).toBe("bot-current");
    expect(s!.hours).toBeUndefined();
  });

  test("friendly names map onto the signal; stochastic level sets both sides", () => {
    const [s] = parseSettingsFile("x", { sessions: TEST_SESSIONS, bollinger: { period: 20, stdDev: 2.2 }, stochastic: { level: 90 }, candle: { sameColourInARow: 4 } });
    expect(s!.signal).toMatchObject({
      bollingerPeriod: 20,
      bollingerStdDev: 2.2,
      stochasticKOverbought: 90,
      stochasticDOverbought: 90,
      stochasticKOversold: 10,
      stochasticDOversold: 10,
      consecutiveCandles: 4,
    });
    expect(s!.values["bollinger.period"]).toBe(20);
  });

  test("lists expand into every combination, labelled by what varies", () => {
    const settings = parseSettingsFile("try", { sessions: TEST_SESSIONS, bollinger: { period: [14, 20] }, stochastic: { level: [85, 90] }, martingale: { levels: 3 } });
    expect(settings.map((s) => s.label)).toEqual([
      "try [bollinger.period=14, stochastic.level=85]",
      "try [bollinger.period=14, stochastic.level=90]",
      "try [bollinger.period=20, stochastic.level=85]",
      "try [bollinger.period=20, stochastic.level=90]",
    ]);
    expect(settings.every((s) => s.martingale.levels === 3)).toBe(true);
  });

  test("an indicator is switched off with use: false; anything but true or false is refused", () => {
    const [s] = parseSettingsFile("x", { sessions: TEST_SESSIONS, donchian: { use: false } });
    expect([s!.signal.useDonchian, s!.signal.useBollinger]).toEqual([false, true]);
    expect(s!.values["donchian.use"]).toBe(false);
    expect(parseSettingsFile("x", { sessions: TEST_SESSIONS, stochastic: { use: [true, false] } }).map((r) => r.signal.useStochastic)).toEqual([true, false]);
    expect(() => parseSettingsFile("x", { sessions: TEST_SESSIONS, donchian: { use: "off" } })).toThrow('"donchian.use" must be true or false');
  });

  test("every problem is listed with its path", () => {
    expect(() =>
      parseSettingsFile("bad", { sessions: TEST_SESSIONS, bolinger: { period: 14 }, bollinger: { priod: 3 }, candle: { minBody: 1.5, sameColourInARow: 2.5 }, martingale: { type: "double" }, hours: ["7-30"] }),
    ).toThrow(
      new RegExp(
        [
          'unknown setting "bolinger"',
          'unknown setting "bollinger.priod" \\(known in bollinger: period, stdDev, use\\)',
          '"candle.minBody" must be between 0 and 1, got 1.5',
          '"candle.sameColourInARow" must be a whole number, got 2.5',
          '"martingale.type" must be "standard" or "recovery" or "cover"',
          '"hours" has "7-30"',
        ].join("[\\s\\S]*"),
      ),
    );
  });

  test("volume is no longer a setting, and the first order is at least IQ Option's 30 THB", () => {
    expect(() => parseSettingsFile("old", { sessions: TEST_SESSIONS, volume: { minVsAverage: 2 } })).toThrow('unknown setting "volume"');
    expect(() => parseSettingsFile("small", { sessions: TEST_SESSIONS, order: { amount: 10 } })).toThrow('"order.amount" must be between 30');
  });

  test("sessions are required, and each rule is checked", () => {
    expect(() => parseSettingsFile("none", {})).toThrow('"sessions" is missing');
    expect(() => parseSettingsFile("empty", { sessions: [] })).toThrow('"sessions" must be a list of session rules');
    expect(() => parseSettingsFile("bad", { sessions: [{ minutes: 0, takeProfit: 10 }, { minutes: 30, stopLossRounds: "1" }] })).toThrow(
      /"sessions"\[0\] has unknown "takeProfit"[\s\S]*"sessions"\[0\]\.minutes must be a whole number between 1 and 1440, got 0[\s\S]*"sessions"\[1\]\.stopLossRounds must be a number/,
    );
    const [s] = parseSettingsFile("ok", { sessions: [{ minutes: 60, takeProfitMultiplier: 10, stopLossRounds: 1 }, { minutes: 30 }] });
    expect(s!.sessions).toEqual([{ minutes: 60, takeProfitMultiplier: 10, stopLossRounds: 1 }, { minutes: 30 }]);
  });

  test("hours", () => {
    const morning = parseHours(["07-11"]).allowed;
    expect(morning.map((a, h) => (a ? h : -1)).filter((h) => h >= 0)).toEqual([7, 8, 9, 10]);
    expect(parseHours(["22-02"]).allowed.filter(Boolean)).toHaveLength(4);
    expect(parseHours(["00-24"]).allowed.every(Boolean)).toBe(true);
    const [s] = parseSettingsFile("x", { sessions: TEST_SESSIONS, hours: ["07-11", "20-23"] });
    expect(s!.hours!.filter(Boolean)).toHaveLength(7);
    expect(s!.values.hours).toEqual(["07-11", "20-23"]);
  });
});

describe("loadSettingsFolder", () => {
  test("reads every json file in name order and reports all broken files at once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "settings-"));
    await writeFile(join(dir, "b.json"), JSON.stringify({ bollinger: { period: 20 }, sessions: TEST_SESSIONS }));
    await writeFile(join(dir, "a.json"), JSON.stringify({ sessions: TEST_SESSIONS }));
    await writeFile(join(dir, "notes.txt"), "ignored");
    expect((await loadSettingsFolder(dir)).map((f) => f.file)).toEqual(["a", "b"]);

    await writeFile(join(dir, "c.json"), "{ not json");
    await writeFile(join(dir, "d.json"), JSON.stringify({ donchian: { period: 0 } }));
    const error = await loadSettingsFolder(dir).catch((e: Error) => e.message);
    expect(error).toContain("c: not valid JSON");
    expect(error).toContain('"donchian.period" must be between 2 and 90, got 0');
  });
});
