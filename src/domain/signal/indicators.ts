/**
 * Indicators over a whole series in one pass each. Index i uses only candles up to i, so the value
 * at i equals what iq-robot computes when i is the last candle of its window. The arithmetic follows
 * iq-robot step by step so floating-point results match exactly. NaN means "not enough candles".
 */

/** Highest value of the `period` values ending at each index. */
export function rollingMax(values: Float64Array, period: number): Float64Array {
  return rollingExtreme(values, period, (a, b) => a >= b);
}

/** Lowest value of the `period` values ending at each index. */
export function rollingMin(values: Float64Array, period: number): Float64Array {
  return rollingExtreme(values, period, (a, b) => a <= b);
}

/** Monotonic deque: O(n) regardless of period. */
function rollingExtreme(values: Float64Array, period: number, keeps: (a: number, b: number) => boolean): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  const deque = new Int32Array(values.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < values.length; i++) {
    while (tail > head && keeps(values[i]!, values[deque[tail - 1]!]!)) tail--;
    deque[tail++] = i;
    if (deque[head]! <= i - period) head++;
    if (i >= period - 1) out[i] = values[deque[head]!]!;
  }
  return out;
}

export interface Bands {
  upper: Float64Array;
  lower: Float64Array;
}

/** Bollinger bands on closes: population standard deviation, as iq-robot computes it. */
export function bollinger(closes: Float64Array, period: number, stdDev: number): Bands {
  const upper = new Float64Array(closes.length).fill(NaN);
  const lower = new Float64Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const sma = sum / period;
    let squares = 0;
    for (let j = i - period + 1; j <= i; j++) squares += Math.pow(closes[j]! - sma, 2);
    const sd = Math.sqrt(squares / period);
    upper[i] = sma + sd * stdDev;
    lower[i] = sma - sd * stdDev;
  }
  return { upper, lower };
}

export interface Stochastic {
  k: Float64Array;
  d: Float64Array;
}

/** Stochastic %K (smoothed) and %D. */
export function stochastic(highs: Float64Array, lows: Float64Array, closes: Float64Array, kPeriod: number, dPeriod: number, smoothing: number): Stochastic {
  const n = closes.length;
  const raw = new Float64Array(n).fill(NaN);
  const highest = rollingMax(highs, kPeriod);
  const lowest = rollingMin(lows, kPeriod);
  for (let i = kPeriod - 1; i < n; i++) {
    raw[i] = ((closes[i]! - lowest[i]!) / (highest[i]! - lowest[i]!)) * 100;
  }
  // iq-robot averages the last `smoothing` raw values (fewer at the very start of its window)
  const k = new Float64Array(n).fill(NaN);
  for (let i = kPeriod - 1; i < n; i++) {
    if (smoothing > 1) {
      const start = Math.max(kPeriod - 1, i - smoothing + 1);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += raw[j]!;
      k[i] = sum / (i - start + 1);
    } else {
      k[i] = raw[i]!;
    }
  }
  const d = new Float64Array(n).fill(NaN);
  for (let i = kPeriod - 1 + dPeriod - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) sum += k[j]!;
    d[i] = sum / dPeriod;
  }
  return { k, d };
}

export interface Levels {
  /** Value of the latest box extreme at each index. */
  value: Float64Array;
  /** Index of that extreme, or -1. iq-robot only sees extremes inside its window. */
  index: Int32Array;
}

/**
 * Support / resistance as iq-robot defines it: a candle whose high is the highest of the last
 * `period` candles marks a resistance level, carried forward until the next one (lows: support).
 */
export function resistanceLevels(highs: Float64Array, period: number): Levels {
  return boxLevels(highs, rollingMax(highs, period), (v, extreme) => v >= extreme);
}

export function supportLevels(lows: Float64Array, period: number): Levels {
  return boxLevels(lows, rollingMin(lows, period), (v, extreme) => v <= extreme);
}

function boxLevels(values: Float64Array, extremes: Float64Array, isLevel: (v: number, extreme: number) => boolean): Levels {
  const value = new Float64Array(values.length).fill(NaN);
  const index = new Int32Array(values.length).fill(-1);
  let last = -1;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(extremes[i]!) && isLevel(values[i]!, extremes[i]!)) last = i;
    index[i] = last;
    if (last >= 0) value[i] = values[last]!;
  }
  return { value, index };
}

/**
 * Same-colour candles in a row ending at each index: +n green, -n red, 0 for a doji (open == close).
 * A doji breaks the run, as in iq-robot.
 */
export function consecutiveColours(opens: Float64Array, closes: Float64Array): Int32Array {
  const out = new Int32Array(closes.length);
  let count = 0;
  for (let i = 0; i < closes.length; i++) {
    const colour = Math.sign(closes[i]! - opens[i]!);
    const previous = i > 0 ? Math.sign(closes[i - 1]! - opens[i - 1]!) : 0;
    if (colour === 0) count = 0;
    else if (colour === previous) count = colour * (Math.abs(count) + 1);
    else count = colour;
    out[i] = count;
  }
  return out;
}
