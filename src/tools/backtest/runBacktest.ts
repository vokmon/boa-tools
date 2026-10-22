import { SignalEngine } from "@/domain/signal";
import { BANGKOK_OFFSET_S, simulateRounds, type Round } from "@/domain/backtest/rounds";
import { groupSplit, summarize, type GroupSplit, type Summary } from "@/domain/backtest/summary";
import { LEVELS_TO_COMPARE, worstCaseStake } from "@/domain/backtest/martingale";
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

export interface AssetResult {
  activeId: number;
  name: string;
  isOtc: boolean;
  rounds: number;
  /** Rounds won by the first order. */
  firstWon: number;
  lost: number;
  profit: number;
}

/** One setting played with one maximum martingale level: everything the report shows for it. */
export interface LevelResult {
  /** Martingale orders allowed after the first one (0 = no martingale). */
  levels: number;
  summary: Summary;
  /** Money lost when every order of one round loses. */
  worstRound: number;
  /** Per asset, best first. */
  byAsset: AssetResult[];
  /** The same for all assets (summary and byAsset above), main assets only and OTC only. */
  groups: AssetGroups;
}

export const ASSET_GROUPS = ["total", "main", "otc"] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

/** One asset group's rounds, on their own. */
export interface GroupResult {
  summary: Summary;
  /** Weekdays, the weekend and the newest 2 weeks. */
  days: GroupSplit;
  /** Per asset in the group, best first. */
  byAsset: AssetResult[];
}

export type AssetGroups = Record<AssetGroup, GroupResult>;

export interface SettingResult {
  setting: RunSetting;
  /** At the setting's own martingale level (the file's martingale.levels). */
  summary: Summary;
  /** Money at risk if every level of one round loses, at the setting's own level. */
  worstCaseStake: number;
  /** Per asset at the setting's own level, best first. */
  byAsset: AssetResult[];
  /** Main / OTC / total at the setting's own level. */
  groups: AssetGroups;
  /** The same signal with max martingale 0 … 4 (and the setting's own level, if different). */
  levels: LevelResult[];
}

export interface BacktestResult {
  period: BacktestPeriod;
  assets: number;
  /** Of `assets`, how many are OTC. */
  otcAssets: number;
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

/** Summary and per-asset results for all assets, and the same for main assets and OTC on their own. */
function withGroups(rounds: readonly Round[], perAsset: AssetResult[], days: readonly string[], levels: number, hours: readonly boolean[] | undefined, otc: ReadonlySet<number>) {
  const byAsset = [...perAsset].sort((a, b) => b.profit - a.profit);
  const group = (keep: (activeId: number) => boolean): GroupResult => {
    const inGroup = rounds.filter((r) => keep(r.activeId));
    return { summary: summarize(inGroup, days, levels, hours), days: groupSplit(inGroup, days, levels), byAsset: byAsset.filter((a) => keep(a.activeId)) };
  };
  const total: GroupResult = { summary: summarize(rounds, days, levels, hours), days: groupSplit(rounds, days, levels), byAsset };
  return { summary: total.summary, byAsset, groups: { total, main: group((id) => !otc.has(id)), otc: group((id) => otc.has(id)) } };
}

/** Levels a setting is played at: 0 … 4, plus its own level if it is outside that. */
function levelsFor(setting: RunSetting): number[] {
  return [...new Set([...LEVELS_TO_COMPARE, setting.martingale.levels])].sort((a, b) => a - b);
}

/**
 * Runs every setting over every asset in the local copy, at max martingale 0 … 4 (the signals are
 * computed once per setting and asset; only the rounds are replayed). `onAsset` reports progress.
 */
export function runBacktest(cache: LocalCandleCache, settings: readonly RunSetting[], size: number, onAsset?: () => void): BacktestResult {
  const period = bangkokPeriod(cache.days(size));
  const assets = cache.assets();
  const otc = new Set(assets.filter((a) => a.isOtc).map((a) => a.activeId));
  const levels = settings.map(levelsFor);
  // rounds[setting][level index], perAsset[setting][level index]
  const rounds: Round[][][] = settings.map((_, i) => levels[i]!.map(() => []));
  const perAsset: AssetResult[][][] = settings.map((_, i) => levels[i]!.map(() => []));
  let candleCount = 0;

  for (const asset of assets) {
    const candles = cache.candles(asset.activeId, size);
    candleCount += candles.length;
    const engine = new SignalEngine(candles, size);
    settings.forEach((setting, i) => {
      const signals = engine.signals(setting.signal);
      levels[i]!.forEach((maxLevel, l) => {
        const assetRounds = simulateRounds(asset.activeId, engine, signals, {
          size,
          martingale: { ...setting.martingale, levels: maxLevel },
          order: setting.order,
          hours: setting.hours,
          from: period.from,
          to: period.to,
        });
        for (const r of assetRounds) rounds[i]![l]!.push(r);
        perAsset[i]![l]!.push({
          activeId: asset.activeId,
          name: asset.name,
          isOtc: asset.isOtc,
          rounds: assetRounds.length,
          firstWon: assetRounds.filter((r) => r.wonAt === 0).length,
          lost: assetRounds.filter((r) => r.wonAt === -1).length,
          profit: assetRounds.reduce((sum, r) => sum + r.profit, 0),
        });
      });
    });
    onAsset?.();
  }

  return {
    period,
    assets: assets.length,
    otcAssets: otc.size,
    candles: candleCount,
    results: settings.map((setting, i) => {
      const views = levels[i]!.map((maxLevel, l): LevelResult => ({
        levels: maxLevel,
        worstRound: worstCaseStake({ ...setting.martingale, levels: maxLevel }, setting.order),
        ...withGroups(rounds[i]![l]!, perAsset[i]![l]!, period.days, maxLevel, setting.hours, otc),
      }));
      const own = views.find((v) => v.levels === setting.martingale.levels)!;
      return { setting, summary: own.summary, worstCaseStake: own.worstRound, byAsset: own.byAsset, groups: own.groups, levels: views };
    }),
  };
}
