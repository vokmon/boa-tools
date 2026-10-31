import { CALL, NO_SIGNAL, PUT, type Candle } from "./types";
import { DEFAULT_SIGNAL_SETTINGS, type SignalSettings } from "./settings";
import { bollinger, consecutiveColours, resistanceLevels, rollingMax, rollingMin, stochastic, supportLevels, type Bands, type Levels, type Stochastic } from "./indicators";

/** iq-robot returns HOLD when it has fewer candles than this. */
const MIN_CANDLES = 20;
/**
 * Indicator arrays kept per engine. Trying many settings uses many periods; beyond this the oldest
 * is dropped and recomputed if needed again, so memory stays bounded (each array is 8 bytes per candle).
 */
const MAX_CACHED_INDICATORS = 8;

/**
 * The bot's signal for every candle of one asset's history, as if that candle had just closed and
 * the bot looked at the `windowSize` candles ending with it. Indicators are computed once per
 * series and cached by their parameters, so trying many settings only recomputes what changed.
 * Prices are kept in typed arrays; the candle objects are not held on to.
 */
export class SignalEngine {
  readonly length: number;
  /** Candle start times (unix seconds), opens and closes, for simulating orders. */
  readonly from: Float64Array;
  readonly opens: Float64Array;
  readonly closes: Float64Array;
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
    this.from = Float64Array.from(candles, (c) => c.from);
    this.opens = Float64Array.from(candles, (c) => c.open);
    this.closes = Float64Array.from(candles, (c) => c.close);
    this.highs = Float64Array.from(candles, (c) => c.max);
    this.lows = Float64Array.from(candles, (c) => c.min);
    this.bodies = Float64Array.from(candles, (c) => Math.abs(c.close - c.open));
    this.contiguous = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.contiguous[i] = i > 0 && this.from[i]! - this.from[i - 1]! === size ? this.contiguous[i - 1]! + 1 : 1;
    }
  }

  /** CALL (1), PUT (-1) or nothing (0) for every candle. Candles without a full gap-free window get 0. */
  signals(s: SignalSettings = DEFAULT_SIGNAL_SETTINGS): Int8Array {
    const out = new Int8Array(this.length);
    const w = s.windowSize;
    // iq-robot returns HOLD when an indicator has no value at the window's last candle
    if (w < MIN_CANDLES) return out;
    if (s.useBollinger && w < s.bollingerPeriod) return out;
    if (s.useStochastic && w < s.stochasticKPeriod + s.stochasticDPeriod - 1) return out;
    if (s.useDonchian && w < s.donchianPeriod) return out;
    // Breakout compares with the previous candle's channel, which must also be inside the window
    const hasPreviousChannel = w - 2 >= s.donchianPeriod - 1;

    // Every indicator looked up once per call, not per candle, and only when its rule is on
    const res = s.useSupportResistance ? this.resistance(s.supportResistancePeriod) : undefined;
    const sup = s.useSupportResistance ? this.support(s.supportResistancePeriod) : undefined;
    const channelHigh = s.useDonchian ? this.cached(`dch:${s.donchianPeriod}`, () => rollingMax(this.highs, s.donchianPeriod)) : undefined;
    const channelLow = s.useDonchian ? this.cached(`dcl:${s.donchianPeriod}`, () => rollingMin(this.lows, s.donchianPeriod)) : undefined;
    const bands = s.useBollinger ? this.cached(`bb:${s.bollingerPeriod}:${s.bollingerStdDev}`, (): Bands => bollinger(this.closes, s.bollingerPeriod, s.bollingerStdDev)) : undefined;
    const stoch = s.useStochastic
      ? this.cached(`st:${s.stochasticKPeriod}:${s.stochasticDPeriod}:${s.stochasticSmoothing}`, (): Stochastic =>
          stochastic(this.highs, this.lows, this.closes, s.stochasticKPeriod, s.stochasticDPeriod, s.stochasticSmoothing),
        )
      : undefined;
    const runs = this.cached("colours", () => consecutiveColours(this.opens, this.closes));

    // Every rule that is on must hold, so they are checked cheapest and most selective first; the
    // result is the same as checking them in iq-robot's order
    for (let e = w - 1; e < this.length; e++) {
      if (this.contiguous[e]! < w) continue;
      // iq-robot counts the run from the start of its window; the run also sets the direction
      const run = runs[e]!;
      const inRow = Math.sign(run) * Math.min(Math.abs(run), w);
      let up = inRow >= s.consecutiveCandles;
      let down = inRow <= -s.consecutiveCandles;
      if (!up && !down) continue;

      if (stoch) {
        const k = stoch.k[e]!;
        const d = stoch.d[e]!;
        up &&= k > s.stochasticKOverbought && (!s.stochasticUseD || d > s.stochasticDOverbought);
        down &&= k < s.stochasticKOversold && (!s.stochasticUseD || d < s.stochasticDOversold);
        if (!up && !down) continue;
      }
      const high = this.highs[e]!;
      const low = this.lows[e]!;
      if (bands) {
        up &&= high > bands.upper[e]!;
        down &&= low < bands.lower[e]!;
        if (!up && !down) continue;
      }
      if (channelHigh && channelLow) {
        up &&= hasPreviousChannel && high > channelHigh[e - 1]!;
        down &&= hasPreviousChannel && low < channelLow[e - 1]!;
        if (!up && !down) continue;
      }

      const start = e - w + 1;
      if (res && sup) {
        // Support / resistance: iq-robot only finds levels inside its window, and the first box
        // there ends at window index period - 1; without both levels it returns HOLD
        const firstBox = start + s.supportResistancePeriod - 1;
        if (res.index[e]! < firstBox || sup.index[e]! < firstBox) continue;
        const mid = (res.value[e]! + sup.value[e]!) / 2;
        const upperZone = res.value[e]! - mid;
        const lowerZone = mid - sup.value[e]!;
        up &&= upperZone > 0 && (high - mid) / upperZone >= s.zonePositionThreshold;
        down &&= lowerZone > 0 && (mid - low) / lowerZone >= s.zonePositionThreshold;
      }
      if (up && this.shapeOk(e, start, s, true) && this.sizeOk(e, start, s)) out[e] = PUT;
      else if (down && this.shapeOk(e, start, s, false) && this.sizeOk(e, start, s)) out[e] = CALL;
    }
    return out;
  }

  /**
   * Body and wick rules: the signal candle and the `candlesToCheckBodyAndWicks` latest all have a
   * valid body, the signal candle's rejection wick (upper for PUT, lower for CALL) is small, and it
   * is no bigger than the earlier checked candles' wicks.
   */
  private shapeOk(e: number, start: number, s: SignalSettings, isPut: boolean): boolean {
    const n = s.candlesToCheckBodyAndWicks;
    if (e - start + 1 < n) return false;
    const lastWick = this.wickRatio(e, isPut);
    if (!(this.bodyRatio(e) >= s.minBodyRatio) || !(lastWick < s.maxRejectionWickRatio)) return false;
    for (let i = e - n + 1; i <= e; i++) {
      if (!(this.bodyRatio(i) >= s.minBodyRatio)) return false;
      if (i < e && !(lastWick <= this.wickRatio(i, isPut))) return false;
    }
    return true;
  }

  private bodyRatio(i: number): number {
    const range = this.highs[i]! - this.lows[i]!;
    return range > 0 ? this.bodies[i]! / range : 0;
  }

  /** Upper wick (PUT) or lower wick (CALL) as a share of the candle's range. */
  private wickRatio(i: number, upper: boolean): number {
    const range = this.highs[i]! - this.lows[i]!;
    if (!(range > 0)) return 0;
    const open = this.opens[i]!;
    const close = this.closes[i]!;
    return upper ? (this.highs[i]! - Math.max(open, close)) / range : (Math.min(open, close) - this.lows[i]!) / range;
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
      if (this.cache.size >= MAX_CACHED_INDICATORS) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, value);
    }
    return value;
  }
}
