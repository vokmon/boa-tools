import { CHECK_DAYS, ROUNDS_PER_DAY_GOAL, type GroupStat } from "@/domain/backtest/summary";
import { ASSET_GROUPS, type AssetGroup, type BacktestResult, type GroupResult, type LevelResult, type SettingResult } from "../runBacktest";
import { defaultValues } from "../settings/settingsFile";
import { CHOICE_FIELDS, NUMBER_FIELDS } from "../settings/fields";
import { DEFAULT_MARTINGALE, roundOutcomes } from "@/domain/backtest/martingale";
import { breakEvenPct, changesFromBot, fullLossEvery, inRoundsGoal, ordered } from "../output/format";
import { RESULT_GUIDE, SETTING_GROUPS, SETTING_GUIDE } from "./guide";

/** Everything report.html shows, embedded in the page as JSON. */
export interface ReportData {
  createdAt: string;
  period: { days: number; from: string; to: string };
  assets: number;
  otcAssets: number;
  candles: number;
  order: { amount: number; payout: number };
  breakEvenPct: number;
  checkDays: number;
  roundsGoal: { min: number; max: number };
  /** One entry per signal: settings that differ only in the martingale multiplier are one signal. */
  settings: ReportSetting[];
  /** What the bar at the top switches between. */
  groupOptions: AssetGroup[];
  multiplierOptions: number[];
  levelOptions: number[];
  guide: {
    results: typeof RESULT_GUIDE;
    groups: { key: string; name: string; about: string; settings: { path: string; name: string; text: string; higher: string; bot: string }[] }[];
  };
}

export interface ReportSetting {
  /** The settings' label without the multiplier. */
  label: string;
  note?: string;
  isBot: boolean;
  changes: string[];
  /** Settings by group, each value marked when it differs from the bot. */
  groups: { name: string; items: { name: string; value: string; bot: string; changed: boolean }[] }[];
  /** views[multiplier][asset group][max martingale level] */
  views: Record<string, Record<AssetGroup, Record<string, ReportView>>>;
}

/** One signal at one multiplier, asset group and max martingale level. */
export interface ReportView {
  levels: number;
  summary: {
    roundsPerDay: number;
    /** Weekdays, the weekend (Saturday and Sunday, Bangkok time) and the newest 2 weeks. */
    weekdays: GroupStat;
    weekend: GroupStat;
    last2Weeks: GroupStat;
    /** Rounds a weekday inside the rounds-a-day goal. */
    roundsInGoal: boolean;
    roundsPerHour: number;
    quietMinutes: number | null;
    roundWinPct: number;
    firstOrderWinPct: number;
    /** Share of finished rounds won by the first order, martingale 1..n, then lost, in percent. */
    endShares: number[];
    /** THB a round ends with for each of those (lost all negative). */
    endMoney: number[];
    /** First-order win week by week, oldest first. */
    weekly: { week: string; rounds: number; firstWinPct: number }[];
    lostPct: number;
    profit: number;
    profitPerDay: number;
    days: number;
    worstDay: { day: string; profit: number } | null;
    biggestDrop: number;
    mostAtOnce: number;
    fullLossEvery: string;
    worstRound: number;
    goodHours: string[];
    avoidHours: string[];
    hours: { hour: number; rounds: number; firstWinPct: number; profit: number; status: string }[];
    check: { heldUp: boolean; beforeFirstWinPct: number; lastFirstWinPct: number; beforePerDay: number; lastPerDay: number };
  };
  bestAssets: { name: string; rounds: number; profit: number }[];
  worstAssets: { name: string; rounds: number; profit: number }[];
}

const MULTIPLIER = "martingale.multiplier";

/** "x [a=1, martingale.multiplier=2.5]" -> "x [a=1]"; "x [martingale.multiplier=2.5]" -> "x" */
function withoutMultiplier(label: string): string {
  return label.replace(/martingale\.multiplier=[^,\]]*(, )?/, "").replace(/, \]/, "]").replace(/ \[\]$/, "");
}

export function reportData(run: BacktestResult): ReportData {
  const rows = ordered(run.results);
  const first = rows[0]!.setting;
  const defaults = defaultValues();
  // Settings that differ only in the multiplier become one signal, in the order they first appear
  const signals = new Map<string, SettingResult[]>();
  for (const r of rows) {
    const key = JSON.stringify([r.setting.file, Object.entries(r.setting.values).filter(([path]) => path !== MULTIPLIER)]);
    signals.set(key, [...(signals.get(key) ?? []), r]);
  }
  const multipliers = [...new Set(rows.map((r) => r.setting.martingale.multiplier))];
  return {
    createdAt: new Date().toISOString(),
    period: { days: run.period.days.length, from: run.period.days[0]!, to: run.period.days.at(-1)! },
    assets: run.assets,
    otcAssets: run.otcAssets,
    candles: run.candles,
    order: first.order,
    breakEvenPct: breakEvenPct(first.order.payout),
    checkDays: CHECK_DAYS,
    roundsGoal: { ...ROUNDS_PER_DAY_GOAL },
    settings: [...signals.values()].map((variants) => setting(variants, defaults)),
    groupOptions: [...ASSET_GROUPS],
    // The bot's multiplier first, so the page opens on it
    multiplierOptions: [...multipliers].sort((a, b) => Number(b === DEFAULT_MARTINGALE.multiplier) - Number(a === DEFAULT_MARTINGALE.multiplier) || b - a),
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

function setting(variants: readonly SettingResult[], defaults: Record<string, number | string>): ReportSetting {
  const r = variants[0]!;
  const changes = changesFromBot(r.setting.values).filter((c) => !c.startsWith(MULTIPLIER));
  const multipliers = variants.map((v) => v.setting.martingale.multiplier);
  return {
    label: withoutMultiplier(r.setting.label),
    ...(r.setting.note ? { note: r.setting.note } : {}),
    isBot: changes.length === 0,
    changes,
    groups: SETTING_GROUPS.map((g) => ({
      name: g.name,
      items: [...NUMBER_FIELDS.map((f) => f.path), ...Object.keys(CHOICE_FIELDS)]
        .filter((path) => path.startsWith(`${g.key}.`))
        .map((path) =>
          path === MULTIPLIER
            ? { name: SETTING_GUIDE[path]?.name ?? path, value: multipliers.join(" / "), bot: String(defaults[path]), changed: multipliers.some((m) => m !== defaults[path]) }
            : { name: SETTING_GUIDE[path]?.name ?? path, value: String(r.setting.values[path]), bot: String(defaults[path]), changed: r.setting.values[path] !== defaults[path] },
        ),
    })).concat(r.setting.values.hours ? [{ name: "Hours", items: [{ name: "Start rounds only", value: (r.setting.values.hours as string[]).join(", "), bot: "all day", changed: true }] }] : []),
    views: Object.fromEntries(
      variants.map((v) => [
        String(v.setting.martingale.multiplier),
        Object.fromEntries(ASSET_GROUPS.map((group) => [group, Object.fromEntries(v.levels.map((l) => [String(l.levels), view(v, l, l.groups[group])]))])) as Record<AssetGroup, Record<string, ReportView>>,
      ]),
    ),
  };
}

function view(r: SettingResult, l: LevelResult, g: GroupResult): ReportView {
  const s = g.summary;
  const finished = Math.max(1, s.rounds - s.stopped);
  return {
    levels: l.levels,
    summary: {
      roundsPerDay: s.roundsPerDay,
      ...g.days,
      roundsInGoal: inRoundsGoal(g.days.weekdays.roundsPerDay),
      roundsPerHour: s.roundsPerHour,
      quietMinutes: s.quietMinutes,
      roundWinPct: s.roundWinPct,
      firstOrderWinPct: s.firstWinPct,
      endShares: [...Array.from({ length: l.levels + 1 }, (_, i) => ((s.wonAtLevel[i] ?? 0) / finished) * 100), (s.lost / finished) * 100],
      endMoney: roundOutcomes({ ...r.setting.martingale, levels: l.levels }, r.setting.order),
      weekly: s.weekly,
      lostPct: (s.lost / finished) * 100,
      profit: s.profit,
      profitPerDay: s.profitPerDay,
      days: s.days,
      worstDay: s.worstDay,
      biggestDrop: s.biggestDrop,
      mostAtOnce: s.mostAtOnce,
      fullLossEvery: fullLossEvery(s.fullLossEveryDays),
      worstRound: -l.worstRound,
      goodHours: s.goodHours,
      avoidHours: s.avoidHours,
      hours: s.hours.map((h) => ({ hour: h.hour, rounds: h.rounds, firstWinPct: h.rounds ? (h.firstWon / h.rounds) * 100 : 0, profit: h.profit, status: h.status })),
      check: { heldUp: s.check.heldUp, beforeFirstWinPct: s.check.before.firstWinPct, lastFirstWinPct: s.check.last.firstWinPct, beforePerDay: s.check.before.profitPerDay, lastPerDay: s.check.last.profitPerDay },
    },
    bestAssets: g.byAsset.slice(0, 5).map((a) => ({ name: a.name, rounds: a.rounds, profit: a.profit })),
    worstAssets: g.byAsset.slice(-5).reverse().map((a) => ({ name: a.name, rounds: a.rounds, profit: a.profit })),
  };
}
