import { SignalEngine, type Candle } from "@/domain/signal";
import { bollinger, consecutiveColours, rollingMax, rollingMin, stochastic } from "@/domain/signal/indicators";
import { CHECK_DAYS } from "@/domain/backtest/summary";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { bangkokPeriod, type BacktestPeriod } from "../runBacktest";

/**
 * How often the next candle reverses after each piece of reversal evidence, on its own.
 *
 * Every candle with a colour is a possible signal: after a green candle the reversal bet is a PUT,
 * after a red one a CALL. It reverses when the next candle closes the other way; a next candle that
 * closes where it opened (a draw) is left out. The evidence is measured in the move's direction,
 * e.g. the stochastic of a green candle is %K, of a red one 100 - %K. The indicator periods are the
 * bot's (stochastic 13/3/3, box 25, Donchian 20, Bollinger 14 x2, size 35 candles, volume 20).
 */

/** Candles before one that it needs: the longest indicator, with room to spare. */
const WARM_UP = 60;
const BOX = 25;
const CHANNEL = 20;
const BANDS = { period: 14, stdDev: 2 };
const STOCH = { k: 13, d: 3, smooth: 3 };
const SIZE_LOOKBACK = 35;
const VOLUME_LOOKBACK = 20;
/** The asset's own recent reversal rate is taken over this many candles before. */
const RECENT = 30;
/** Assets listed at each end of the per-asset table. */
const ASSETS_SHOWN = 10;

export interface Tally {
  candles: number;
  reversed: number;
}

/** One bucket of one piece of evidence, split by asset group and by period. */
export interface BucketResult {
  name: string;
  otc: { older: Tally; newest: Tally };
  main: { older: Tally; newest: Tally };
}

export interface EvidenceResult {
  key: string;
  name: string;
  about: string;
  buckets: BucketResult[];
}

export interface EvidenceRun {
  period: BacktestPeriod;
  /** Newest days, kept for checking. */
  checkDays: number;
  assets: number;
  candles: number;
  evidence: EvidenceResult[];
}

/** Everything one asset's candles give, computed once. */
interface Series {
  n: number;
  open: Float64Array;
  close: Float64Array;
  high: Float64Array;
  low: Float64Array;
  volume: Float64Array;
  runs: Int32Array;
  k: Float64Array;
  boxHigh: Float64Array;
  boxLow: Float64Array;
  channelHigh: Float64Array;
  channelLow: Float64Array;
  upper: Float64Array;
  lower: Float64Array;
  /** Running totals: index i holds the sum over candles 0 … i - 1, so "the L candles before i" is sums[i] - sums[i - L]. */
  bodySums: Float64Array;
  volumeSums: Float64Array;
  /** Candles that reversed the one before them, and candles where that is known (neither is a doji). */
  reversedSums: Float64Array;
  outcomeSums: Float64Array;
  botSignal: Int8Array;
}

interface Feature {
  key: string;
  name: string;
  about: string;
  buckets: readonly string[];
  /** Bucket index for candle i moving `dir` (1 green, -1 red), or -1 to leave it out. */
  bucket: (s: Series, i: number, dir: number, hour: number) => number;
}

/** Index of the first edge `value` is below; the last bucket when above all. */
function band(value: number, edges: readonly number[]): number {
  if (Number.isNaN(value)) return -1;
  const i = edges.findIndex((e) => value < e);
  return i < 0 ? edges.length : i;
}

const range = (s: Series, i: number) => s.high[i]! - s.low[i]!;

const FEATURES: readonly Feature[] = [
  {
    key: "bot",
    name: "The bot's signal",
    about: "Whether the bot's current settings fire on the candle (a check: it should match the backtest's first-order win).",
    buckets: ["no signal", "signal"],
    bucket: (s, i) => (s.botSignal[i] !== 0 ? 1 : 0),
  },
  {
    key: "run",
    name: "Same colour in a row",
    about: "How many candles of the move's colour in a row, ending with this one.",
    buckets: ["1", "2", "3", "4", "5", "6 or more"],
    bucket: (s, i) => Math.min(Math.abs(s.runs[i]!), 6) - 1,
  },
  {
    key: "stochastic",
    name: "Stochastic %K, in the move's direction",
    about: "Where the close sits in the last 13 candles' range: 100 = at the top after a green candle (at the bottom after a red one).",
    buckets: ["under 50", "50-70", "70-80", "80-90", "90-95", "95 or more"],
    bucket: (s, i, dir) => band(dir > 0 ? s.k[i]! : 100 - s.k[i]!, [50, 70, 80, 90, 95]),
  },
  {
    key: "zone",
    name: "Position in the support/resistance box",
    about: "How far the candle reaches into the top half of the last 25 candles' box (bottom half for a red candle), as the bot measures it; 1 = a new 25-candle high (low).",
    buckets: ["under 0.5", "0.5-0.8", "0.8-0.9", "0.9-0.95", "0.95-1", "new high/low (1)"],
    bucket: (s, i, dir) => {
      const top = s.boxHigh[i]!;
      const bottom = s.boxLow[i]!;
      const mid = (top + bottom) / 2;
      if (!(top - mid > 0)) return -1;
      const position = dir > 0 ? (s.high[i]! - mid) / (top - mid) : (mid - s.low[i]!) / (mid - bottom);
      return position >= 1 ? 5 : band(position, [0.5, 0.8, 0.9, 0.95]);
    },
  },
  {
    key: "bollinger",
    name: "Outside the Bollinger band",
    about: "Whether the high pokes above the upper band after a green candle (the low below the lower band after a red one).",
    buckets: ["inside", "outside"],
    bucket: (s, i, dir) => (Number.isNaN(s.upper[i]!) ? -1 : (dir > 0 ? s.high[i]! > s.upper[i]! : s.low[i]! < s.lower[i]!) ? 1 : 0),
  },
  {
    key: "donchian",
    name: "Donchian breakout",
    about: "Whether the candle breaks the previous 20 candles' high after a green candle (low after a red one).",
    buckets: ["no breakout", "breakout"],
    bucket: (s, i, dir) => (dir > 0 ? s.high[i]! > s.channelHigh[i - 1]! : s.low[i]! < s.channelLow[i - 1]!) ? 1 : 0,
  },
  {
    key: "body",
    name: "Body share of the candle",
    about: "The body as a share of the high-to-low range: 1 = no wicks at all.",
    buckets: ["under 0.3", "0.3-0.5", "0.5-0.7", "0.7-0.9", "0.9 or more"],
    bucket: (s, i) => (range(s, i) > 0 ? band(Math.abs(s.close[i]! - s.open[i]!) / range(s, i), [0.3, 0.5, 0.7, 0.9]) : -1),
  },
  {
    key: "wick",
    name: "Wick against the move",
    about: "The upper wick after a green candle (lower after a red one) as a share of the range: a long one means the price was pushed back, the classic rejection. The bot today requires it small.",
    buckets: ["none", "under 0.1", "0.1-0.25", "0.25-0.4", "0.4 or more"],
    bucket: (s, i, dir) => {
      if (!(range(s, i) > 0)) return -1;
      const wick = dir > 0 ? s.high[i]! - Math.max(s.open[i]!, s.close[i]!) : Math.min(s.open[i]!, s.close[i]!) - s.low[i]!;
      return wick <= 0 ? 0 : band(wick / range(s, i), [0.1, 0.25, 0.4]) + 1;
    },
  },
  {
    key: "size",
    name: "Body vs the average body",
    about: "The body against the average body of the 35 candles before: 2 = twice as big as usual.",
    buckets: ["under 0.5", "0.5-1", "1-1.5", "1.5-2", "2-3", "3 or more"],
    bucket: (s, i) => {
      const average = (s.bodySums[i]! - s.bodySums[i - SIZE_LOOKBACK]!) / SIZE_LOOKBACK;
      return average > 0 ? band(Math.abs(s.close[i]! - s.open[i]!) / average, [0.5, 1, 1.5, 2, 3]) : -1;
    },
  },
  {
    key: "volume",
    name: "Volume vs the average volume",
    about: "The candle's volume against the average of the 20 candles before. OTC assets have no volume.",
    buckets: ["no volume", "under 0.5", "0.5-1", "1-1.5", "1.5-2", "2-3", "3 or more"],
    bucket: (s, i) => {
      const average = (s.volumeSums[i]! - s.volumeSums[i - VOLUME_LOOKBACK]!) / VOLUME_LOOKBACK;
      return average > 0 ? band(s.volume[i]! / average, [0.5, 1, 1.5, 2, 3]) + 1 : 0;
    },
  },
  {
    key: "recent",
    name: "The asset's recent reversals",
    about: "How often this asset's candles reversed over its last 30 candles: does reversing come in streaks?",
    buckets: ["under 40%", "40-45%", "45-50%", "50-55%", "55-60%", "60% or more"],
    bucket: (s, i) => {
      // Known when candle i closes: whether each of the last 30 candles, i included, reversed the one before
      const outcomes = s.outcomeSums[i + 1]! - s.outcomeSums[i + 1 - RECENT]!;
      return outcomes >= RECENT / 2 ? band(((s.reversedSums[i + 1]! - s.reversedSums[i + 1 - RECENT]!) / outcomes) * 100, [40, 45, 50, 55, 60]) : -1;
    },
  },
  {
    key: "hour",
    name: "Hour (Bangkok)",
    about: "The Bangkok hour the next candle (the order) starts in.",
    buckets: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`),
    bucket: (_s, _i, _dir, hour) => hour,
  },
];

const tally = (): Tally => ({ candles: 0, reversed: 0 });
const emptyBucket = (name: string): BucketResult => ({ name, otc: { older: tally(), newest: tally() }, main: { older: tally(), newest: tally() } });

/** Runs every piece of evidence over every asset in the local copy. `onAsset` reports progress. */
export function reversalEvidence(cache: LocalCandleCache, size: number, onAsset?: () => void): EvidenceRun {
  const period = bangkokPeriod(cache.days(size));
  const split = period.to - CHECK_DAYS * 86_400;
  const results: EvidenceResult[] = FEATURES.map((f) => ({ key: f.key, name: f.name, about: f.about, buckets: f.buckets.map(emptyBucket) }));
  const assets: EvidenceResult = { key: "asset", name: "Asset", about: "Each asset on its own, by its reversals on the older days; the newest 2 weeks show whether it lasts.", buckets: [] };
  let candleCount = 0;

  for (const asset of cache.assets()) {
    const candles = cache.candles(asset.activeId, size);
    candleCount += candles.length;
    const s = series(candles, size);
    const own = emptyBucket(asset.name);
    const contiguous = contiguity(candles, size);
    for (let i = WARM_UP; i < s.n - 1; i++) {
      const start = candles[i + 1]!.from;
      if (start < period.from || start >= period.to || contiguous[i]! < WARM_UP || candles[i + 1]!.from - candles[i]!.from !== size) continue;
      const dir = Math.sign(s.close[i]! - s.open[i]!);
      const next = Math.sign(s.close[i + 1]! - s.open[i + 1]!);
      if (dir === 0 || next === 0) continue;
      const reversed = next === -dir;
      const hour = Math.floor(((start + 7 * 3600) % 86_400) / 3600);
      const pick = (b: BucketResult) => (asset.isOtc ? b.otc : b.main)[start < split ? "older" : "newest"];
      FEATURES.forEach((f, fi) => {
        const b = f.bucket(s, i, dir, hour);
        if (b < 0) return;
        const t = pick(results[fi]!.buckets[b]!);
        t.candles++;
        if (reversed) t.reversed++;
      });
      const t = pick(own);
      t.candles++;
      if (reversed) t.reversed++;
    }
    assets.buckets.push(own);
    onAsset?.();
  }

  // Assets: the best and the worst on the older days, each with its newest 2 weeks
  const olderRate = (b: BucketResult) => rate([b.otc.older, b.main.older]);
  const ranked = assets.buckets.filter((b) => b.otc.older.candles + b.main.older.candles > 0).sort((a, b) => olderRate(b) - olderRate(a));
  assets.buckets = ranked.length > ASSETS_SHOWN * 2 ? [...ranked.slice(0, ASSETS_SHOWN), ...ranked.slice(-ASSETS_SHOWN)] : ranked;
  return { period, checkDays: CHECK_DAYS, assets: cache.assets().length, candles: candleCount, evidence: [...results, assets] };
}

/** Reversal rate in percent over some tallies; NaN without candles. */
export function rate(tallies: readonly Tally[]): number {
  let candles = 0;
  let reversed = 0;
  for (const t of tallies) {
    candles += t.candles;
    reversed += t.reversed;
  }
  return candles ? (reversed / candles) * 100 : NaN;
}

function series(candles: readonly Candle[], size: number): Series {
  const n = candles.length;
  const open = Float64Array.from(candles, (c) => c.open);
  const close = Float64Array.from(candles, (c) => c.close);
  const high = Float64Array.from(candles, (c) => c.max);
  const low = Float64Array.from(candles, (c) => c.min);
  const volume = Float64Array.from(candles, (c) => c.volume ?? 0);
  const bodySums = new Float64Array(n + 1);
  const volumeSums = new Float64Array(n + 1);
  const reversedSums = new Float64Array(n + 1);
  const outcomeSums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    bodySums[i + 1] = bodySums[i]! + Math.abs(close[i]! - open[i]!);
    volumeSums[i + 1] = volumeSums[i]! + volume[i]!;
    // Candle i reversed: it and the one before it have opposite colours (known once i closes)
    const here = Math.sign(close[i]! - open[i]!);
    const before = i > 0 ? Math.sign(close[i - 1]! - open[i - 1]!) : 0;
    const known = here !== 0 && before !== 0;
    outcomeSums[i + 1] = outcomeSums[i]! + (known ? 1 : 0);
    reversedSums[i + 1] = reversedSums[i]! + (known && here === -before ? 1 : 0);
  }
  const bands = bollinger(close, BANDS.period, BANDS.stdDev);
  const stoch = stochastic(high, low, close, STOCH.k, STOCH.d, STOCH.smooth);
  return {
    n,
    open,
    close,
    high,
    low,
    volume,
    runs: consecutiveColours(open, close),
    k: stoch.k,
    boxHigh: rollingMax(high, BOX),
    boxLow: rollingMin(low, BOX),
    channelHigh: rollingMax(high, CHANNEL),
    channelLow: rollingMin(low, CHANNEL),
    upper: bands.upper,
    lower: bands.lower,
    bodySums,
    volumeSums,
    reversedSums,
    outcomeSums,
    botSignal: new SignalEngine(candles, size).signals(),
  };
}

/** Candles in a row ending at each index with no time gap. */
function contiguity(candles: readonly Candle[], size: number): Int32Array {
  const out = new Int32Array(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = i > 0 && candles[i]!.from - candles[i - 1]!.from === size ? out[i - 1]! + 1 : 1;
  return out;
}
