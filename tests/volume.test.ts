import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignalEngine, withDefaults, type Candle } from "@/domain/signal";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { parseSettingsFile } from "@/tools/backtest/settings/settingsFile";

const SIZE = 60;
const fixture = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(`${import.meta.dir}/fixtures/candles.json.gz`).bytes()))) as {
  series: { candles: [number, number, number, number, number][] }[];
};
const real = fixture.series[0]!.candles.map(([from, open, close, min, max]): Candle => ({ from, open, close, min, max }));
const botSignals = new SignalEngine(real, SIZE).signals();
const signalAt = [...botSignals.keys()].filter((i) => botSignals[i] !== 0);

/** The real candles with volume 100 everywhere, and `atSignal` on the candles where the bot signals. */
function withVolume(atSignal: number, elsewhere = 100): Candle[] {
  const signal = new Set(signalAt);
  return real.map((c, i) => ({ ...c, volume: signal.has(i) ? atSignal : elsewhere }));
}

function count(signals: Int8Array): number {
  return signals.filter((s) => s !== 0).length;
}

describe("volume rule", () => {
  test("off by default: the same signals as the bot, with or without volume data", () => {
    expect(signalAt.length).toBeGreaterThan(10);
    expect([...new SignalEngine(withVolume(500), SIZE).signals()]).toEqual([...botSignals]);
  });

  test("minVsAverage keeps busy signal candles and drops ordinary ones", () => {
    const busy = withDefaults({ volumeMinRatio: 2 });
    // 300 against an average of about 100: kept. 150: dropped
    expect([...new SignalEngine(withVolume(300), SIZE).signals(busy)]).toEqual([...botSignals]);
    expect(count(new SignalEngine(withVolume(150), SIZE).signals(busy))).toBe(0);
  });

  test("maxVsAverage keeps quiet signal candles and drops busy ones", () => {
    const quiet = withDefaults({ volumeMaxRatio: 0.8 });
    expect([...new SignalEngine(withVolume(50), SIZE).signals(quiet)]).toEqual([...botSignals]);
    expect(count(new SignalEngine(withVolume(150), SIZE).signals(quiet))).toBe(0);
  });

  test("the average is of the candles before the signal candle, not including it", () => {
    // One signal candle trades 1,000,000 against 100 before it: 10,000x. If its own volume were in
    // the average, the ratio would be about 20x and fail the 5,000x rule
    const spike = signalAt[0]!;
    const candles = real.map((c, i) => ({ ...c, volume: i === spike ? 1_000_000 : 100 }));
    const signals = new SignalEngine(candles, SIZE).signals(withDefaults({ volumeMinRatio: 5000, volumeLookback: 20 }));
    expect([...signals.keys()].filter((i) => signals[i] !== 0)).toEqual([spike]);
  });

  test("without volume (OTC): trade ignores the rule, skip does not trade", () => {
    const otc = new SignalEngine(withVolume(0, 0), SIZE);
    expect([...otc.signals(withDefaults({ volumeMinRatio: 2, withoutVolume: "trade" }))]).toEqual([...botSignals]);
    expect(count(otc.signals(withDefaults({ withoutVolume: "skip" })))).toBe(0);
    // An asset with volume is not affected by "skip"
    expect([...new SignalEngine(withVolume(100), SIZE).signals(withDefaults({ withoutVolume: "skip" }))]).toEqual([...botSignals]);
  });
});

describe("volume settings", () => {
  test("the volume group maps onto the signal, off by default", () => {
    const [off] = parseSettingsFile("x", {});
    expect(off!.signal).toMatchObject({ volumeMinRatio: 0, volumeMaxRatio: 0, volumeLookback: 20, withoutVolume: "trade" });
    const [on] = parseSettingsFile("x", { volume: { minVsAverage: 1.5, lookback: 30, withoutVolume: "skip" } });
    expect(on!.signal).toMatchObject({ volumeMinRatio: 1.5, volumeLookback: 30, withoutVolume: "skip" });
    expect(parseSettingsFile("x", { volume: { minVsAverage: [1.5, 2, 3] } })).toHaveLength(3);
  });

  test("bad values are reported", () => {
    expect(() => parseSettingsFile("x", { volume: { withoutVolume: "maybe" } })).toThrow('"volume.withoutVolume" must be "trade" or "skip"');
    expect(() => parseSettingsFile("x", { volume: { lookback: 100 } })).toThrow('"volume.lookback" must be between 1 and 99');
    expect(() => parseSettingsFile("x", { volume: { minVsAverge: 2 } })).toThrow("known in volume: minVsAverage, maxVsAverage, lookback, withoutVolume");
  });
});

describe("local copy", () => {
  test("keeps volume", () => {
    const cache = new LocalCandleCache(":memory:");
    cache.replaceDays(1, SIZE, [{ activeId: 1, day: "2026-10-20", candleCount: 1, collectedAt: "x" }], [{ from: 1792454400, open: 1, close: 2, min: 0, max: 3, volume: 42 }]);
    expect(cache.candles(1, SIZE)[0]!.volume).toBe(42);
  });

  test("a copy made before volume gets the column and is copied again on the next sync", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "cache-")), "candles.sqlite");
    const old = new Database(path);
    old.exec(`CREATE TABLE candles (active_id INTEGER NOT NULL, size INTEGER NOT NULL, from_ts INTEGER NOT NULL, open REAL NOT NULL, close REAL NOT NULL,
      min REAL NOT NULL, max REAL NOT NULL, PRIMARY KEY (active_id, size, from_ts)) WITHOUT ROWID;
      CREATE TABLE days (active_id INTEGER NOT NULL, size INTEGER NOT NULL, day TEXT NOT NULL, candle_count INTEGER NOT NULL, collected_at TEXT NOT NULL,
      PRIMARY KEY (active_id, size, day)) WITHOUT ROWID;
      INSERT INTO candles VALUES (1, 60, 1792454400, 1, 2, 0, 3);
      INSERT INTO days VALUES (1, 60, '2026-10-20', 1, 'x');`);
    old.close();

    const cache = new LocalCandleCache(path);
    expect(cache.candles(1, SIZE)[0]!.volume).toBe(0);
    // No day counts as held any more, so the sync copies them all again, now with volume
    expect(cache.dayVersions(SIZE).size).toBe(0);
    cache.close();
  });
});
