import type { SignalSettings } from "@/domain/signal";

/**
 * The numbers a settings file can set, by their path in the file. One table drives validation,
 * the mapping to the signal engine, docs/settings.md and the AI brief, so they cannot disagree.
 */
export interface NumberField {
  path: string;
  /** Plain-English meaning, for docs and the AI brief. */
  about: string;
  integer: boolean;
  min: number;
  max: number;
  /** Values worth trying, for the AI brief. */
  tryRange: [number, number];
  /** Where the value goes in the signal settings; absent for martingale / order fields. */
  signal?: (keyof SignalSettings)[];
}

export const NUMBER_FIELDS: readonly NumberField[] = [
  { path: "supportResistance.period", about: "candles in the support/resistance box (highest high / lowest low)", integer: true, min: 2, max: 90, tryRange: [15, 40], signal: ["supportResistancePeriod"] },
  { path: "supportResistance.zone", about: "how close to the top (PUT) or bottom (CALL) of the box the candle must reach, 0-1", integer: false, min: 0, max: 1, tryRange: [0.85, 0.98], signal: ["zonePositionThreshold"] },
  { path: "donchian.period", about: "candles in the Donchian channel the signal candle must break out of", integer: true, min: 2, max: 90, tryRange: [10, 40], signal: ["donchianPeriod"] },
  { path: "bollinger.period", about: "candles in the Bollinger bands the signal candle must poke outside", integer: true, min: 2, max: 90, tryRange: [10, 30], signal: ["bollingerPeriod"] },
  { path: "bollinger.stdDev", about: "Bollinger band width in standard deviations (wider = rarer signals)", integer: false, min: 0.5, max: 5, tryRange: [1.8, 2.8], signal: ["bollingerStdDev"] },
  { path: "stochastic.k", about: "stochastic %K period", integer: true, min: 2, max: 60, tryRange: [5, 21], signal: ["stochasticKPeriod"] },
  { path: "stochastic.d", about: "stochastic %D period (average of %K)", integer: true, min: 1, max: 20, tryRange: [2, 5], signal: ["stochasticDPeriod"] },
  { path: "stochastic.smooth", about: "stochastic %K smoothing", integer: true, min: 1, max: 20, tryRange: [1, 5], signal: ["stochasticSmoothing"] },
  {
    path: "stochastic.level",
    about: "PUT only when %K and %D are above this; CALL when below 100 minus it (higher = more stretched, rarer)",
    integer: false,
    min: 50,
    max: 100,
    tryRange: [75, 95],
    signal: ["stochasticKOverbought", "stochasticDOverbought"],
  },
  { path: "candle.sameColourInARow", about: "candles of the same colour in a row, ending with the signal candle", integer: true, min: 1, max: 20, tryRange: [1, 5], signal: ["consecutiveCandles"] },
  { path: "candle.minBody", about: "the body must be at least this share of the candle's high-low range, 0-1", integer: false, min: 0, max: 1, tryRange: [0.4, 0.8], signal: ["minBodyRatio"] },
  { path: "candle.maxWick", about: "the wick against the move must be under this share of the range, 0-1", integer: false, min: 0, max: 1, tryRange: [0.1, 0.4], signal: ["maxRejectionWickRatio"] },
  { path: "candle.checkLast", about: "how many latest candles the body and wick rules apply to", integer: true, min: 1, max: 10, tryRange: [1, 3], signal: ["candlesToCheckBodyAndWicks"] },
  { path: "candle.minSizeVsAverage", about: "the latest candles' bodies must each be at least this times the recent average body", integer: false, min: 0, max: 5, tryRange: [0.5, 1.5], signal: ["minCandleSizeRatio"] },
  { path: "candle.sizeCandles", about: "how many latest candles the size rule applies to", integer: true, min: 1, max: 10, tryRange: [1, 5], signal: ["candlesToCheckSize"] },
  { path: "candle.sizeLookback", about: "candles the average body is taken over, before the latest ones", integer: true, min: 5, max: 90, tryRange: [20, 60], signal: ["sizeLookback"] },
  { path: "martingale.multiplier", about: "standard martingale: each level stakes this times the previous one", integer: false, min: 1, max: 10, tryRange: [2, 3] },
  { path: "martingale.levels", about: "martingale levels after the first order (4 = up to 5 orders per round)", integer: true, min: 0, max: 8, tryRange: [2, 4] },
  { path: "order.amount", about: "stake of the first order, THB (IQ Option takes 30 at least)", integer: false, min: 30, max: 1_000_000, tryRange: [30, 30] },
  { path: "order.payout", about: "profit on a win, percent of the stake", integer: false, min: 1, max: 100, tryRange: [80, 90] },
  { path: "trading.maxOpenRounds", about: "most rounds open at once across all assets; a signal is skipped while that many are running (0 = no limit)", integer: true, min: 0, max: 1000, tryRange: [1, 5] },
];

export const FIELD_BY_PATH = new Map(NUMBER_FIELDS.map((f) => [f.path, f]));

/** Settings that are a choice between a few values; the first value is the default. */
export const CHOICE_FIELDS: Readonly<Record<string, readonly (string | boolean)[]>> = {
  // Each rule switched on (true) or off (false); the bot uses all of them
  "supportResistance.use": [true, false],
  "donchian.use": [true, false],
  "bollinger.use": [true, false],
  "stochastic.use": [true, false],
  // %D past the level as well as %K
  "stochastic.useD": [true, false],
  "martingale.type": ["standard", "recovery", "cover"],
};
