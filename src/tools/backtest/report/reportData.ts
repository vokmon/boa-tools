import { CHECK_DAYS } from "@/domain/backtest/summary";
import type { BacktestResult, LevelResult, SettingResult } from "../runBacktest";
import { defaultValues } from "../settings/settingsFile";
import { NUMBER_FIELDS } from "../settings/fields";
import { roundOutcomes } from "@/domain/backtest/martingale";
import { breakEvenPct, changesFromBot, fullLossEvery, ordered } from "../output/format";
import { RESULT_GUIDE, SETTING_GROUPS, SETTING_GUIDE } from "./guide";

/** Everything report.html shows, embedded in the page as JSON. */
export interface ReportData {
  createdAt: string;
  period: { days: number; from: string; to: string };
  assets: number;
  candles: number;
  order: { amount: number; payout: number };
  levels: number;
  breakEvenPct: number;
  checkDays: number;
  settings: ReportSetting[];
  /** Max martingale levels the page can switch between. */
  levelOptions: number[];
  guide: {
    results: typeof RESULT_GUIDE;
    groups: { key: string; name: string; about: string; settings: { path: string; name: string; text: string; higher: string; bot: string }[] }[];
  };
}

export interface ReportSetting {
  label: string;
  note?: string;
  isBot: boolean;
  changes: string[];
  /** Settings by group, each value marked when it differs from the bot. */
  groups: { name: string; items: { name: string; value: string; bot: string; changed: boolean }[] }[];
  /** The file's own max martingale level. */
  ownLevel: number;
  /** The level with the most profit per day. */
  bestLevel: number;
  /** Everything the page shows, for each max martingale level (0 … 4, and the own level). */
  views: Record<string, ReportView>;
}

/** One setting with one max martingale level. */
export interface ReportView {
  levels: number;
  summary: {
    roundsPerDay: number;
    roundWinPct: number;
    firstOrderWinPct: number;
    /** Share of finished rounds won by the first order, martingale 1..n, then lost, in percent. */
    endShares: number[];
    /** THB a round ends with for each of those (lost all negative). */
    endMoney: number[];
    /** Profit of each day, oldest first. */
    daily: { day: string; profit: number }[];
    daysInProfit: number;
    lostPct: number;
    profit: number;
    profitPerDay: number;
    losingDays: number;
    days: number;
    worstDay: { day: string; profit: number } | null;
    biggestDrop: number;
    mostAtOnce: number;
    fullLossEvery: string;
    worstRound: number;
    goodHours: string[];
    avoidHours: string[];
    hours: { hour: number; rounds: number; winPct: number; profit: number; status: string }[];
    check: { heldUp: boolean; beforeWinPct: number; lastWinPct: number; beforePerDay: number; lastPerDay: number };
  };
  bestAssets: { name: string; rounds: number; profit: number }[];
  worstAssets: { name: string; rounds: number; profit: number }[];
}

export function reportData(run: BacktestResult): ReportData {
  const rows = ordered(run.results);
  const first = rows[0]!.setting;
  const defaults = defaultValues();
  const levels = Math.max(...rows.map((r) => r.setting.martingale.levels));
  return {
    createdAt: new Date().toISOString(),
    period: { days: run.period.days.length, from: run.period.days[0]!, to: run.period.days.at(-1)! },
    assets: run.assets,
    candles: run.candles,
    order: first.order,
    levels,
    breakEvenPct: breakEvenPct(first.order.payout),
    checkDays: CHECK_DAYS,
    settings: rows.map((r) => setting(r, defaults)),
    levelOptions: [...new Set(rows.flatMap((r) => r.levels.map((l) => l.levels)))].sort((a, b) => a - b),
    guide: {
      results: RESULT_GUIDE,
      groups: SETTING_GROUPS.map((g) => ({
        key: g.key,
        name: g.name,
        about: g.about,
        settings: Object.entries(SETTING_GUIDE)
          .filter(([path]) => path.startsWith(`${g.key}.`))
          .map(([path, e]) => ({ path, name: e.name, text: e.text, higher: e.higher, bot: String(defaults[path]) })),
      })),
    },
  };
}

function setting(r: SettingResult, defaults: Record<string, number | string>): ReportSetting {
  const changes = changesFromBot(r.setting.values);
  const best = [...r.levels].sort((a, b) => b.summary.profitPerDay - a.summary.profitPerDay)[0]!;
  return {
    label: r.setting.label,
    ...(r.setting.note ? { note: r.setting.note } : {}),
    isBot: changes.length === 0,
    changes,
    groups: SETTING_GROUPS.map((g) => ({
      name: g.name,
      items: [...NUMBER_FIELDS.map((f) => f.path), "martingale.type"]
        .filter((path) => path.startsWith(`${g.key}.`))
        .map((path) => ({ name: SETTING_GUIDE[path]?.name ?? path, value: String(r.setting.values[path]), bot: String(defaults[path]), changed: r.setting.values[path] !== defaults[path] })),
    })).concat(r.setting.values.hours ? [{ name: "Hours", items: [{ name: "Start rounds only", value: (r.setting.values.hours as string[]).join(", "), bot: "all day", changed: true }] }] : []),
    ownLevel: r.setting.martingale.levels,
    bestLevel: best.levels,
    views: Object.fromEntries(r.levels.map((l) => [String(l.levels), view(r, l)])),
  };
}

function view(r: SettingResult, l: LevelResult): ReportView {
  const s = l.summary;
  const finished = Math.max(1, s.rounds - s.stopped);
  return {
    levels: l.levels,
    summary: {
      roundsPerDay: s.roundsPerDay,
      roundWinPct: s.roundWinPct,
      firstOrderWinPct: ((s.wonAtLevel[0] ?? 0) / finished) * 100,
      endShares: [...Array.from({ length: l.levels + 1 }, (_, i) => ((s.wonAtLevel[i] ?? 0) / finished) * 100), (s.lost / finished) * 100],
      endMoney: roundOutcomes({ ...r.setting.martingale, levels: l.levels }, r.setting.order),
      daily: s.daily.map((d) => ({ day: d.day, profit: d.profit })),
      daysInProfit: s.daily.filter((d) => d.profit > 0).length,
      lostPct: (s.lost / finished) * 100,
      profit: s.profit,
      profitPerDay: s.profitPerDay,
      losingDays: s.losingDays,
      days: s.days,
      worstDay: s.worstDay,
      biggestDrop: s.biggestDrop,
      mostAtOnce: s.mostAtOnce,
      fullLossEvery: fullLossEvery(s.fullLossEveryDays),
      worstRound: -l.worstRound,
      goodHours: s.goodHours,
      avoidHours: s.avoidHours,
      hours: s.hours.map((h) => ({ hour: h.hour, rounds: h.rounds, winPct: h.rounds ? (h.won / h.rounds) * 100 : 0, profit: h.profit, status: h.status })),
      check: { heldUp: s.check.heldUp, beforeWinPct: s.check.before.roundWinPct, lastWinPct: s.check.last.roundWinPct, beforePerDay: s.check.before.profitPerDay, lastPerDay: s.check.last.profitPerDay },
    },
    bestAssets: l.byAsset.slice(0, 5).map((a) => ({ name: a.name, rounds: a.rounds, profit: a.profit })),
    worstAssets: l.byAsset.slice(-5).reverse().map((a) => ({ name: a.name, rounds: a.rounds, profit: a.profit })),
  };
}
