import { describe, expect, test } from "bun:test";
import { LocalCandleCache } from "@/storage/LocalCandleCache";
import { bangkokPeriod } from "@/tools/backtest/runBacktest";
import { rate, reversalEvidence } from "@/tools/backtest/evidence/reversalEvidence";
import { evidenceLines } from "@/tools/backtest/evidence/evidenceOutput";
import { syntheticCache } from "./helpers/syntheticCache";

const SIZE = 60;

describe("reversal evidence", () => {
  test("every candle with an outcome is counted once per piece of evidence, with its true reversal", async () => {
    const cache = new LocalCandleCache(await syntheticCache());
    const run = reversalEvidence(cache, SIZE);

    // Count directly: candles (after warm-up) whose next candle, in the test days, closes against them
    const period = bangkokPeriod(cache.days(SIZE));
    let candles = 0;
    let reversed = 0;
    for (const asset of cache.assets()) {
      const c = cache.candles(asset.activeId, SIZE);
      for (let i = 60; i < c.length - 1; i++) {
        const start = c[i + 1]!.from;
        const dir = Math.sign(c[i]!.close - c[i]!.open);
        const next = Math.sign(c[i + 1]!.close - c[i + 1]!.open);
        if (start < period.from || start >= period.to || dir === 0 || next === 0) continue;
        candles++;
        if (next === -dir) reversed++;
      }
    }
    cache.close();

    const totals = (key: string) => {
      const e = run.evidence.find((x) => x.key === key)!;
      const tallies = e.buckets.flatMap((b) => [b.otc.older, b.otc.newest, b.main.older, b.main.newest]);
      return { candles: tallies.reduce((n, t) => n + t.candles, 0), rate: rate(tallies) };
    };
    // Evidence that every candle has puts each candle in exactly one bucket
    for (const key of ["bot", "run", "hour", "volume"]) expect(totals(key)).toEqual({ candles, rate: (reversed / candles) * 100 });
    // A random walk reverses about half the time
    expect(totals("run").rate).toBeGreaterThan(45);
    expect(totals("run").rate).toBeLessThan(55);
  });

  test("the synthetic assets have no volume, so every candle is in \"no volume\"", async () => {
    const cache = new LocalCandleCache(await syntheticCache());
    const run = reversalEvidence(cache, SIZE);
    cache.close();
    const volume = run.evidence.find((e) => e.key === "volume")!;
    expect(volume.buckets.slice(1).every((b) => b.otc.older.candles + b.otc.newest.candles === 0)).toBe(true);
    expect(evidenceLines(run).join("\n")).toContain("Volume vs the average volume");
  });
});
