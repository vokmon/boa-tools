import { describe, expect, test } from "bun:test";
import { calculateSignalWithCandle, type SignalCalculationConfig } from "./reference/iq-robot/signalWithCandleCalculator";
import { calculateSignalWithCandle as calculateCurrentSignal } from "./reference/iq-robot/current/signalWithCandleCalculator";
import { SignalEngine, withDefaults, type Candle, type SignalSettings } from "@/domain/signal";
import { consecutiveColours, rollingMax, rollingMin } from "@/domain/signal/indicators";

const SIZE = 60;

/** Real 1-minute candles (see tests/fixtures), several asset-days with PUT and CALL signals. */
const fixture = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(`${import.meta.dir}/fixtures/candles.json.gz`).bytes()))) as {
  series: { name: string; day: string; candles: [number, number, number, number, number][] }[];
};
const series = fixture.series.map((s) => ({
  label: `${s.name} ${s.day}`,
  candles: s.candles.map(([from, open, close, min, max]): Candle => ({ from, open, close, min, max })),
}));

/**
 * The bot's settings before 27/10/2026, which the older iq-robot copy implements: %K and %D, the
 * size rule, and the values of that time.
 */
const BEFORE_27_10: Partial<SignalSettings> = {
  stochasticUseD: true,
  useCandleSize: true,
  zonePositionThreshold: 0.92,
  stochasticKPeriod: 13,
  stochasticKOverbought: 85,
  stochasticKOversold: 15,
  stochasticDOverbought: 85,
  stochasticDOversold: 15,
  minBodyRatio: 0.6,
  maxRejectionWickRatio: 0.25,
};

/** The settings as the older iq-robot's config, for the knobs it lets a caller change. */
function referenceConfig(s: SignalSettings): SignalCalculationConfig {
  return {
    supportResistancePeriod: s.supportResistancePeriod,
    zonePositionThreshold: s.zonePositionThreshold,
    donchianPeriod: s.donchianPeriod,
    bollingerPeriod: s.bollingerPeriod,
    bollingerStdDev: s.bollingerStdDev,
    stochasticKPeriod: s.stochasticKPeriod,
    stochasticDPeriod: s.stochasticDPeriod,
    stochasticSmoothing: s.stochasticSmoothing,
    stochasticKOverboughtThreshold: s.stochasticKOverbought,
    stochasticKOversoldThreshold: s.stochasticKOversold,
    stochasticDOverboughtThreshold: s.stochasticDOverbought,
    stochasticDOversoldThreshold: s.stochasticDOversold,
    minCandlesToCheckSize: s.candlesToCheckSize,
    // lookback = max(minCandleSizeLookbackPeriod, floor(windowSize * lookbackPercentage))
    minCandleSizeLookbackPeriod: s.sizeLookback,
    lookbackPercentage: 0,
    minCandleSizeRatio: s.minCandleSizeRatio,
  };
}

/** The settings as the current iq-robot's signal-settings.json. */
function currentReferenceSettings(s: SignalSettings) {
  return {
    window: { candles: s.windowSize, minCandles: 20 },
    supportResistance: { use: s.useSupportResistance, period: s.supportResistancePeriod, zone: s.zonePositionThreshold },
    donchian: { use: s.useDonchian, period: s.donchianPeriod },
    bollinger: { use: s.useBollinger, period: s.bollingerPeriod, stdDev: s.bollingerStdDev },
    stochastic: { use: s.useStochastic, k: s.stochasticKPeriod, d: s.stochasticDPeriod, smooth: s.stochasticSmoothing, kOverbought: s.stochasticKOverbought, kOversold: s.stochasticKOversold },
    rsi: { period: 14 },
    candle: { sameColourInARow: s.consecutiveCandles, useShape: true, minBody: s.minBodyRatio, maxWick: s.maxRejectionWickRatio },
  };
}

/** What the bot does: for each candle with a full gap-free window, run iq-robot on that window. */
function signalsOf(candles: readonly Candle[], windowSize: number, calculate: (window: never) => { signal: string }): Int8Array {
  const out = new Int8Array(candles.length);
  for (let e = windowSize - 1; e < candles.length; e++) {
    const window = candles.slice(e - windowSize + 1, e + 1);
    if (window.some((c, i) => i > 0 && c.from - window[i - 1]!.from !== SIZE)) continue;
    const sdkCandles = window.map((c) => ({ ...c, id: c.from / SIZE, to: c.from + SIZE, volume: 0, at: undefined }));
    const { signal } = calculate(sdkCandles as never);
    out[e] = signal === "put" ? -1 : signal === "call" ? 1 : 0;
  }
  return out;
}

/** The bot before 27/10/2026 (%K and %D, size rule). */
function referenceSignals(candles: readonly Candle[], s: SignalSettings): Int8Array {
  const config = referenceConfig(s);
  return signalsOf(candles, s.windowSize, (w) => calculateSignalWithCandle(w, config));
}

/** The bot since 27/10/2026 (%K only, no size rule). */
function currentReferenceSignals(candles: readonly Candle[], s: SignalSettings): Int8Array {
  const settings = currentReferenceSettings(s);
  return signalsOf(candles, s.windowSize, (w) => calculateCurrentSignal(w, settings as never));
}

function count(signals: Int8Array): { put: number; call: number } {
  let put = 0;
  let call = 0;
  for (const s of signals) {
    if (s === -1) put++;
    else if (s === 1) call++;
  }
  return { put, call };
}

/** Indexes where the two differ, for a readable failure. */
function differences(a: Int8Array, b: Int8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

describe("SignalEngine matches iq-robot on real candles", () => {
  test("bot defaults: same signal on every candle", () => {
    let total = 0;
    for (const { label, candles } of series) {
      const expected = currentReferenceSignals(candles, withDefaults());
      const actual = new SignalEngine(candles, SIZE).signals();
      expect({ label, diff: differences(actual, expected) }).toEqual({ label, diff: [] });
      const { put, call } = count(expected);
      total += put + call;
    }
    // The samples were picked to contain signals; an all-HOLD match would prove nothing
    expect(total).toBeGreaterThan(50);
  });

  const variants: [string, Partial<SignalSettings>][] = [
    ["wider Bollinger", { bollingerPeriod: 20, bollingerStdDev: 2.2 }],
    ["longer Donchian, shorter box", { donchianPeriod: 30, supportResistancePeriod: 15, zonePositionThreshold: 0.85 }],
    ["fast stochastic, looser level", { stochasticKPeriod: 9, stochasticDPeriod: 2, stochasticSmoothing: 1, stochasticKOverbought: 75, stochasticKOversold: 25 }],
    ["looser candle", { minBodyRatio: 0.6, maxRejectionWickRatio: 0.3, consecutiveCandles: 2 }],
    ["rules off", { useDonchian: false, useStochastic: false }],
    ["shorter window", { windowSize: 60 }],
  ];
  for (const [name, change] of variants) {
    test(`${name}: same signal on every candle`, () => {
      const settings = withDefaults(change);
      for (const { label, candles } of series.slice(0, 3)) {
        const expected = currentReferenceSignals(candles, settings);
        const actual = new SignalEngine(candles, SIZE).signals(settings);
        expect({ label, diff: differences(actual, expected) }).toEqual({ label, diff: [] });
      }
    });
  }
});

describe("SignalEngine matches iq-robot before 27/10/2026 (%D, size rule)", () => {
  test("that bot's settings: same signal on every candle", () => {
    let total = 0;
    for (const { label, candles } of series) {
      const settings = withDefaults(BEFORE_27_10);
      const expected = referenceSignals(candles, settings);
      const actual = new SignalEngine(candles, SIZE).signals(settings);
      expect({ label, diff: differences(actual, expected) }).toEqual({ label, diff: [] });
      const { put, call } = count(expected);
      total += put + call;
    }
    expect(total).toBeGreaterThan(50);
  });

  const variants: [string, Partial<SignalSettings>][] = [
    ["wider Bollinger", { bollingerPeriod: 20, bollingerStdDev: 2.2 }],
    ["longer Donchian, shorter box", { donchianPeriod: 30, supportResistancePeriod: 15, zonePositionThreshold: 0.85 }],
    ["fast stochastic, looser levels", { stochasticKPeriod: 9, stochasticDPeriod: 2, stochasticSmoothing: 1, stochasticKOverbought: 80, stochasticKOversold: 20, stochasticDOverbought: 75, stochasticDOversold: 25 }],
    ["size rule", { candlesToCheckSize: 2, sizeLookback: 25, minCandleSizeRatio: 1 }],
    ["shorter window", { windowSize: 60 }],
  ];
  for (const [name, change] of variants) {
    test(`${name}: same signal on every candle`, () => {
      const settings = withDefaults({ ...BEFORE_27_10, ...change });
      for (const { label, candles } of series.slice(0, 3)) {
        const expected = referenceSignals(candles, settings);
        const actual = new SignalEngine(candles, SIZE).signals(settings);
        expect({ label, diff: differences(actual, expected) }).toEqual({ label, diff: [] });
      }
    });
  }
});

describe("knobs iq-robot hard-codes", () => {
  // iq-robot cannot take these, so check the next best thing: every rule is an AND, so a stricter
  // value can only remove signals, never add one
  const stricter: [string, Partial<SignalSettings>][] = [
    ["more same-colour candles", { consecutiveCandles: 4 }],
    ["bigger body", { minBodyRatio: 0.9 }],
    ["smaller wick", { maxRejectionWickRatio: 0.15 }],
    ["more candles checked for body and wick", { candlesToCheckBodyAndWicks: 2 }],
  ];
  for (const [name, change] of stricter) {
    test(`${name}: only removes signals`, () => {
      for (const { candles } of series) {
        const engine = new SignalEngine(candles, SIZE);
        const base = engine.signals();
        const strict = engine.signals(withDefaults(change));
        for (let i = 0; i < base.length; i++) {
          if (strict[i] !== 0) expect(strict[i]).toBe(base[i]!);
        }
      }
    });
  }

  test("looser values add signals", () => {
    const engine = new SignalEngine(series[0]!.candles, SIZE);
    const base = count(engine.signals());
    const loose = count(engine.signals(withDefaults({ consecutiveCandles: 2, minBodyRatio: 0.5 })));
    expect(loose.put + loose.call).toBeGreaterThan(base.put + base.call);
  });
});

describe("switching rules on and off", () => {
  test("a rule switched off only adds signals", () => {
    const off: Partial<SignalSettings>[] = [{ useSupportResistance: false }, { useDonchian: false }, { useBollinger: false }, { useStochastic: false }, { stochasticUseD: false }, { useCandleSize: false }];
    for (const { candles } of series) {
      const engine = new SignalEngine(candles, SIZE);
      const a = engine.signals();
      for (const loose of off) {
        const b = engine.signals(withDefaults(loose));
        for (let i = 0; i < a.length; i++) if (a[i] !== 0) expect(b[i]).toBe(a[i]!);
      }
    }
  });

  test("with the price rules off, a signal is just the same-colour run against its direction", () => {
    const { candles } = series[0]!;
    const engine = new SignalEngine(candles, SIZE);
    const off = { useSupportResistance: false, useDonchian: false, useBollinger: false, useStochastic: false, consecutiveCandles: 3, minBodyRatio: 0, maxRejectionWickRatio: 1, minCandleSizeRatio: 0 };
    const signals = engine.signals(withDefaults(off));
    const runs = consecutiveColours(Float64Array.from(candles, (c) => c.open), Float64Array.from(candles, (c) => c.close));
    let checked = 0;
    for (let i = 100; i < candles.length; i++) {
      // A zero-range candle has no wick ratio to pass; skip those
      if (candles[i]!.max === candles[i]!.min || signals[i] === 0) continue;
      expect(signals[i]).toBe(runs[i]! >= 3 ? -1 : 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(count(signals).put + count(signals).call).toBeGreaterThan(count(engine.signals()).put + count(engine.signals()).call);
  });
});

describe("gaps", () => {
  test("no signal while the window crosses a market gap", () => {
    const { candles } = series[0]!;
    // Open a 10-minute hole in the middle; the next 100 candles have no full window
    const gap = 800;
    const shifted = candles.map((c, i) => (i >= gap ? { ...c, from: c.from + 600 } : c));
    const signals = new SignalEngine(shifted, SIZE).signals();
    expect([...signals.slice(gap, gap + 99)].every((s) => s === 0)).toBe(true);
  });
});

describe("indicators", () => {
  test("rolling max and min", () => {
    const values = Float64Array.from([3, 1, 4, 1, 5, 9, 2, 6]);
    expect([...rollingMax(values, 3)]).toEqual([NaN, NaN, 4, 4, 5, 9, 9, 9]);
    expect([...rollingMin(values, 3)]).toEqual([NaN, NaN, 1, 1, 1, 1, 2, 2]);
  });

  test("same-colour runs; a doji resets", () => {
    const opens = Float64Array.from([1, 2, 3, 3, 3, 2, 1]);
    const closes = Float64Array.from([2, 3, 4, 3, 4, 1, 0]);
    expect([...consecutiveColours(opens, closes)]).toEqual([1, 2, 3, 0, 1, -1, -2]);
  });
});
