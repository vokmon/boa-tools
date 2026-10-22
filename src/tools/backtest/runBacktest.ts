import { SignalEngine } from "@/domain/signal";
import { BANGKOK_OFFSET_S, simulateRounds, type Round } from "@/domain/backtest/rounds";
import { summarize, type Summary } from "@/domain/backtest/summary";
import { worstCaseStake } from "@/domain/backtest/martingale";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import type { RunSetting } from "./settings/settingsFile";

const DAY_S = 86_400;

export interface BacktestPeriod {
  /** Bangkok days the results cover, oldest first. */
  days: string[];
  /** Rounds starting in [from, to), unix seconds. */
  from: number;
  to: number;
}

export interface SettingResult {
  setting: RunSetting;
  summary: Summary;
  /** Money at risk if every level of one round loses. */
  worstCaseStake: number;
  /** Per asset: rounds, round win % and profit, for the detail view and the AI brief. */
  byAsset: { activeId: number; name: string; isOtc: boolean; rounds: number; lost: number; profit: number }[];
}

export interface BacktestResult {
  period: BacktestPeriod;
  assets: number;
  candles: number;
  results: SettingResult[];
}

/**
 * The full Bangkok days inside the local data. The data is in UTC days (07:00-07:00 Bangkok), so
 * the first and last Bangkok days are only partly covered and are left out.
 */
export function bangkokPeriod(utcDays: readonly string[]): BacktestPeriod {
  if (utcDays.length < 3) throw new Error("Need at least 3 days of candles; run collect-candles first");
  const first = Date.parse(`${utcDays[0]}T00:00:00Z`) / 1000;
  const last = Date.parse(`${utcDays.at(-1)}T00:00:00Z`) / 1000;
  // Bangkok midnight after the first UTC day starts, up to Bangkok midnight before the data ends
  const from = first + DAY_S - BANGKOK_OFFSET_S;
  const to = last + DAY_S - BANGKOK_OFFSET_S;
  const days: string[] = [];
  for (let t = from; t < to; t += DAY_S) days.push(new Date((t + BANGKOK_OFFSET_S) * 1000).toISOString().slice(0, 10));
  return { days, from, to };
}

/** Runs every setting over every asset in the local copy; `onAsset` reports progress. */
export function runBacktest(cache: LocalCandleCache, settings: readonly RunSetting[], size: number, onAsset?: () => void): BacktestResult {
  const period = bangkokPeriod(cache.days(size));
  const assets = cache.assets();
  const rounds: Round[][] = settings.map(() => []);
  const perAsset = settings.map(() => [] as SettingResult["byAsset"]);
  let candleCount = 0;

  for (const asset of assets) {
    const candles = cache.candles(asset.activeId, size);
    candleCount += candles.length;
    const engine = new SignalEngine(candles, size);
    settings.forEach((setting, i) => {
      const assetRounds = simulateRounds(asset.activeId, candles, engine.signals(setting.signal), {
        size,
        martingale: setting.martingale,
        order: setting.order,
        hours: setting.hours,
        from: period.from,
        to: period.to,
      });
      rounds[i]!.push(...assetRounds);
      perAsset[i]!.push({
        activeId: asset.activeId,
        name: asset.name,
        isOtc: asset.isOtc,
        rounds: assetRounds.length,
        lost: assetRounds.filter((r) => r.wonAt === -1).length,
        profit: assetRounds.reduce((s, r) => s + r.profit, 0),
      });
    });
    onAsset?.();
  }

  return {
    period,
    assets: assets.length,
    candles: candleCount,
    results: settings.map((setting, i) => ({
      setting,
      summary: summarize(rounds[i]!, period.days, setting.martingale.levels),
      worstCaseStake: worstCaseStake(setting.martingale, setting.order),
      byAsset: perAsset[i]!.sort((a, b) => b.profit - a.profit),
    })),
  };
}
