import type { Candles } from "@quadcode-tech/client-sdk-js";
import { retry } from "@/lib/retry";
import type { RawCandle } from "./types";

const DAY_S = 86_400;
/** The broker returns at most 1000 candles per request (the newest ones in the range). */
const MAX_PER_REQUEST = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Half a day per request: 720 one-minute candles, under the cap. */
const SLICE_S = DAY_S / 2;

export class CandlesService {
  constructor(
    private readonly candles: Pick<Candles, "getCandles">,
    private readonly nowS: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /**
   * Every candle that starts inside the UTC day beginning at `dayStart` (unix seconds), oldest first.
   * Sized for 1-minute candles; a request that comes back at the cap throws instead of losing data.
   * For today it stops at now, since the broker rejects ranges in the future.
   */
  async fetchDay(activeId: number, size: number, dayStart: number): Promise<RawCandle[]> {
    const byFrom = new Map<number, RawCandle>();
    const now = this.nowS();
    for (let from = dayStart; from < dayStart + DAY_S && from <= now; from += SLICE_S) {
      const to = Math.min(from + SLICE_S - 1, now);
      const batch = await retry(() => withTimeout(this.candles.getCandles(activeId, size, { from, to }), REQUEST_TIMEOUT_MS), {
        label: `candles ${activeId} ${new Date(from * 1000).toISOString()}`,
      });
      if (batch.length >= MAX_PER_REQUEST) throw new Error(`candles ${activeId}: request hit the ${MAX_PER_REQUEST} cap, slice is too wide`);
      for (const c of batch) {
        if (c.from >= dayStart && c.from < dayStart + DAY_S) byFrom.set(c.from, toRaw(c));
      }
    }
    return [...byFrom.values()].sort((a, b) => a.from - b.from);
  }
}

function toRaw(c: RawCandle): RawCandle {
  return { id: c.id, from: c.from, to: c.to, open: c.open, close: c.close, min: c.min, max: c.max, volume: c.volume, at: c.at };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
