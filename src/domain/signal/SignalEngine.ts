import { CALL, NO_SIGNAL, PUT, type Candle } from "./types";
import { DEFAULT_SIGNAL_SETTINGS, type SignalSettings } from "./settings";
import { bollinger, consecutiveColours, resistanceLevels, rollingMax, rollingMin, stochastic, supportLevels, type Bands, type Levels, type Stochastic } from "./indicators";

/** iq-robot returns HOLD when it has fewer candles than this. */
const MIN_CANDLES = 20;

/**
 * The bot's signal for every candle of one asset's history, as if that candle had just closed and
 * the bot looked at the `windowSize` candles ending with it. Indicators are computed once per
 * series and cached by their parameters, so trying many settings only recomputes what changed.
 */
export class SignalEngine {
  readonly length: number;
  private readonly opens: Float64Array;
  private readonly closes: Float64Array;
  private readonly highs: Float64Array;
  private readonly lows: Float64Array;
  private readonly bodies: Float64Array;
  /** Candles in a row, ending at each index, with no time gap between them. */
  private readonly contiguous: Int32Array;
  private readonly cache = new Map<string, unknown>();

  /**
   * @param candles one asset, oldest first
   * @param size candle size in seconds; a jump in `from` larger than this is a market gap, and the
   *   bot would not have a full window across it
   */
  constructor(candles: readonly Candle[], size: number) {
    const n = candles.length;
    this.length = n;
    this.opens = Float64Array.from(candles, (c) => c.open);
    this.closes = Float64Array.from(candles, (c) => c.close);
    this.highs = Float64Array.from(candles, (c) => c.max);
    this.lows = Float64Array.from(candles, (c) => c.min);
    this.bodies = Float64Array.from(candles, (c) => Math.abs(c.close - c.open));
    this.contiguous = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.contiguous[i] = i > 0 && candles[i]!.from - candles[i - 1]!.from === size ? this.contiguous[i - 1]! + 1 : 1;
    }
  }

  /** CALL (1), PUT (-1) or nothing (0) for every candle. Candles without a full gap-free window get 0. */
  signals(settings: SignalSettings = DEFAULT_SIGNAL_SETTINGS): Int8Array {
    const out = new Int8Array(this.length);
    for (let i = settings.windowSize - 1; i < this.length; i++) {
      if (this.contiguous[i]! >= settings.windowSize) out[i] = this.signalAt(i, settings);
    }
    return out;
  }

  /** The signal at index `e`, with the window [e - windowSize + 1, e]. */
  private signalAt(e: number, s: SignalSettings): number {
    const w = s.windowSize;
    const start = e - w + 1;
    if (w < MIN_CANDLES) return NO_SIGNAL;

    // Support / resistance: iq-robot only finds levels inside its window, and the first box
    // there ends at window index period - 1
    const firstBox = start + s.supportResistancePeriod - 1;
    const res = this.resistance(s.supportResistancePeriod);
    const sup = this.support(s.supportResistancePeriod);
    if (res.index[e]! < firstBox || sup.index[e]! < firstBox) return NO_SIGNAL;
    const resistance = res.value[e]!;
    const support = sup.value[e]!;

    // iq-robot returns HOLD when an indicator has no value at the last candle
    if (e - start < s.bollingerPeriod - 1) return NO_SIGNAL;
    if (e - start < s.stochasticKPeriod - 1 + s.stochasticDPeriod - 1) return NO_SIGNAL;
    if (e - start < s.donchianPeriod - 1) return NO_SIGNAL;

    const high = this.highs[e]!;
    const low = this.lows[e]!;
    const mid = (resistance + support) / 2;
    const upperZone = resistance - mid;
    const lowerZone = mid - support;
    const nearResistance = upperZone > 0 && (high - mid) / upperZone >= s.zonePositionThreshold;
    const nearSupport = lowerZone > 0 && (mid - low) / lowerZone >= s.zonePositionThreshold;

    // Breakout against the previous candle's channel, which must also be inside the window
    const hasPreviousChannel = e - 1 - start >= s.donchianPeriod - 1;
    const channelHigh = this.cached(`dch:${s.donchianPeriod}`, () => rollingMax(this.highs, s.donchianPeriod));
    const channelLow = this.cached(`dcl:${s.donchianPeriod}`, () => rollingMin(this.lows, s.donchianPeriod));
    const upperBreakout = hasPreviousChannel && high > channelHigh[e - 1]!;
    const lowerBreakout = hasPreviousChannel && low < channelLow[e - 1]!;

    const bands = this.cached(`bb:${s.bollingerPeriod}:${s.bollingerStdDev}`, (): Bands => bollinger(this.closes, s.bollingerPeriod, s.bollingerStdDev));
    const aboveBand = high > bands.upper[e]!;
    const belowBand = low < bands.lower[e]!;

    const stoch = this.cached(`st:${s.stochasticKPeriod}:${s.stochasticDPeriod}:${s.stochasticSmoothing}`, (): Stochastic =>
      stochastic(this.highs, this.lows, this.closes, s.stochasticKPeriod, s.stochasticDPeriod, s.stochasticSmoothing),
    );
    const k = stoch.k[e]!;
    const d = stoch.d[e]!;
    const overbought = k > s.stochasticKOverbought && d > s.stochasticDOverbought;
    const oversold = k < s.stochasticKOversold && d < s.stochasticDOversold;

    // iq-robot counts the run from the start of its window
    const run = this.cached("colours", () => consecutiveColours(this.opens, this.closes))[e]!;
    const inRow = Math.sign(run) * Math.min(Math.abs(run), e - start + 1);

    const shape = this.candleShape(e, start, s);
    const sizeOk = this.sizeOk(e, start, s);

    const put =
      nearResistance && upperBreakout && aboveBand && overbought && inRow >= s.consecutiveCandles && shape.putOk && sizeOk;
    if (put) return PUT;
    const call =
      nearSupport && lowerBreakout && belowBand && oversold && inRow <= -s.consecutiveCandles && shape.callOk && sizeOk;
    return call ? CALL : NO_SIGNAL;
  }

  /** Body and wick rules on the signal candle and on the latest `candlesToCheckBodyAndWicks`. */
  private candleShape(e: number, start: number, s: SignalSettings): { putOk: boolean; callOk: boolean } {
    const last = this.metrics(e, s);
    const n = s.candlesToCheckBodyAndWicks;
    if (e - start + 1 < n) return { putOk: false, callOk: false };
    let allValid = true;
    let smallestUpper = true;
    let smallestLower = true;
    for (let i = e - n + 1; i <= e; i++) {
      const m = this.metrics(i, s);
      if (!m.validBody) allValid = false;
      if (i < e) {
        if (!(last.upperWickRatio <= m.upperWickRatio)) smallestUpper = false;
        if (!(last.lowerWickRatio <= m.lowerWickRatio)) smallestLower = false;
      }
    }
    return {
      putOk: last.validBody && last.smallUpperWick && allValid && smallestUpper,
      callOk: last.validBody && last.smallLowerWick && allValid && smallestLower,
    };
  }

  private metrics(i: number, s: SignalSettings) {
    const high = this.highs[i]!;
    const low = this.lows[i]!;
    const open = this.opens[i]!;
    const close = this.closes[i]!;
    const range = high - low;
    const bodyRatio = range > 0 ? this.bodies[i]! / range : 0;
    const upperWickRatio = range > 0 ? (high - Math.max(open, close)) / range : 0;
    const lowerWickRatio = range > 0 ? (Math.min(open, close) - low) / range : 0;
    return {
      validBody: bodyRatio >= s.minBodyRatio,
      upperWickRatio,
      lowerWickRatio,
      smallUpperWick: upperWickRatio < s.maxRejectionWickRatio,
      smallLowerWick: lowerWickRatio < s.maxRejectionWickRatio,
    };
  }

  /** The latest `candlesToCheckSize` bodies are each at least `minCandleSizeRatio` of the average before them. */
  private sizeOk(e: number, start: number, s: SignalSettings): boolean {
    const n = s.candlesToCheckSize;
    const lookback = s.sizeLookback;
    if (e - start + 1 < lookback + n) return false;
    let total = 0;
    for (let i = e - n - lookback + 1; i <= e - n; i++) total += this.bodies[i]!;
    const average = total / lookback;
    if (average <= 0) return false;
    const minimum = average * s.minCandleSizeRatio;
    for (let i = e - n + 1; i <= e; i++) {
      if (!(this.bodies[i]! >= minimum)) return false;
    }
    return true;
  }

  private resistance(period: number): Levels {
    return this.cached(`res:${period}`, () => resistanceLevels(this.highs, period));
  }

  private support(period: number): Levels {
    return this.cached(`sup:${period}`, () => supportLevels(this.lows, period));
  }

  private cached<T>(key: string, compute: () => T): T {
    let value = this.cache.get(key) as T | undefined;
    if (value === undefined) {
      value = compute();
      this.cache.set(key, value);
    }
    return value;
  }
}
