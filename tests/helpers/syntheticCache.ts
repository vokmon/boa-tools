import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCandleCache } from "@/storage/LocalCandleCache";

/** Small seeded random generator (mulberry32), so the test data is the same every run. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Five days of random-walk 1-minute candles for three assets, in a local cache file. */
export async function syntheticCache(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "backtest-")), "candles.sqlite");
  const cache = new LocalCandleCache(path);
  const random = seededRandom(1);
  const days = ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"];
  cache.replaceAssets([1, 2, 3].map((activeId) => ({ activeId, name: `A${activeId}`, isOtc: true, precision: 5, firstSeen: "", lastSeen: "" })));
  for (const activeId of [1, 2, 3]) {
    let price = 100;
    const candles = [];
    for (let t = Date.parse(`${days[0]}T00:00:00Z`) / 1000; t < Date.parse("2026-10-20T00:00:00Z") / 1000; t += 60) {
      const open = price;
      price = Math.max(1, price + (random() - 0.5) * 0.4);
      candles.push({ id: t / 60, from: t, to: t + 60, open, close: price, min: Math.min(open, price) - random() * 0.1, max: Math.max(open, price) + random() * 0.1, volume: 0, at: undefined });
    }
    cache.replaceDays(activeId, 60, days.map((day) => ({ activeId, day, candleCount: 1440, collectedAt: "x" })), candles);
  }
  cache.close();
  return path;
}
