import { BANGKOK_OFFSET_S, LOST, STOPPED, bangkokHour, type Round } from "./rounds";

/**
 * An hour needs at least this many rounds before it is called good or bad; with fewer, a couple of
 * lost rounds decide the hour and the good / avoid pattern is noise.
 */
export const MIN_ROUNDS_PER_HOUR = 100;
/** Days at the end used for the "last 2 weeks" check. */
export const CHECK_DAYS = 14;
/**
 * Rounds a day, all assets together, that keep the app busy without ordering nonstop: fewer looks
 * idle, more is an order almost every minute (see the backtest README, "What we are looking for").
 */
export const ROUNDS_PER_DAY_GOAL = { min: 600, max: 1000 } as const;
/** "Quiet stretch" is the wait between new rounds that this share of waits stay under. */
const QUIET_SHARE = 0.9;

export type HourStatus = "good" | "ok" | "avoid" | "few";

export interface HourStat {
  hour: number;
  rounds: number;
  won: number;
  /** Rounds won by the first order. */
  firstWon: number;
  profit: number;
  status: HourStatus;
}

export interface PeriodStat {
  days: number;
  rounds: number;
  roundWinPct: number;
  firstWinPct: number;
  profitPerDay: number;
  profitPerRound: number;
}

export interface Summary {
  days: number;
  rounds: number;
  roundsPerDay: number;
  /** Rounds per hour the setting may trade (all day, or its `hours`). */
  roundsPerHour: number;
  /**
   * Minutes between one new round and the next that 9 in 10 waits stay under, within the hours the
   * setting trades; null with fewer than two rounds.
   */
  quietMinutes: number | null;
  /** Rounds that ended in a win at any level, in percent of rounds that finished. */
  roundWinPct: number;
  /** Rounds won by the first order (no martingale), in percent of rounds that finished. */
  firstWinPct: number;
  /** Rounds won at level 0 (no martingale), 1, 2, ... */
  wonAtLevel: number[];
  lost: number;
  /** Rounds cut short by a market gap (not counted in round win %). */
  stopped: number;
  /** Days per round that lost every level; null when none did. */
  fullLossEveryDays: number | null;
  profit: number;
  profitPerDay: number;
  losingDays: number;
  worstDay: { day: string; profit: number } | null;
  /** Largest fall of the running total from a high point, as a negative number. */
  biggestDrop: number;
  /** Most rounds running at the same moment across all assets. */
  mostAtOnce: number;
  hours: HourStat[];
  /** Bangkok hour ranges, e.g. "07-11" (end exclusive). */
  goodHours: string[];
  avoidHours: string[];
  daily: { day: string; rounds: number; profit: number }[];
  /** The test cut into PARTS equal stretches of days, oldest first: does it hold over time? */
  parts: PartStat[];
  /** The last 2 weeks against the days before them. */
  check: { before: PeriodStat; last: PeriodStat; heldUp: boolean };
}

/** Rounds per day, first-order win and profit per day of some rounds, over some days. */
export interface GroupStat {
  days: number;
  roundsPerDay: number;
  firstWinPct: number;
  /** Share of finished rounds won by the first order, martingale 1 … levels, then lost all, in percent. */
  ends: number[];
  profitPerDay: number;
}

/**
 * One asset group (or all assets) on weekdays and at the weekend (Bangkok calendar days), and the
 * newest 2 weeks. Main assets almost stop at the weekend, so an average over all days hides how
 * busy a setting is on a normal trading day.
 */
export interface GroupSplit {
  weekdays: GroupStat;
  weekend: GroupStat;
  last2Weeks: GroupStat;
}

/** Saturday or Sunday, for a Bangkok day "yyyy-mm-dd". */
export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The split of some rounds over the test days; rounds outside the days are ignored. */
export function groupSplit(rounds: readonly Round[], days: readonly string[], levels: number): GroupSplit {
  const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const index = new Map(days.map((d, i) => [dayNumber(d), i]));
  const weekend = days.map(isWeekend);
  const checkSplit = Math.max(0, days.length - CHECK_DAYS);
  const buckets = { weekdays: [] as Round[], weekend: [] as Round[], last2Weeks: [] as Round[] };
  for (const r of rounds) {
    const i = index.get(Math.floor((r.start + BANGKOK_OFFSET_S) / 86_400));
    if (i === undefined) continue;
    (weekend[i] ? buckets.weekend : buckets.weekdays).push(r);
    if (i >= checkSplit) buckets.last2Weeks.push(r);
  }
  const weekendDays = weekend.filter(Boolean).length;
  return {
    weekdays: groupStat(buckets.weekdays, days.length - weekendDays, levels),
    weekend: groupStat(buckets.weekend, weekendDays, levels),
    last2Weeks: groupStat(buckets.last2Weeks, days.length - checkSplit, levels),
  };
}

function groupStat(rounds: readonly Round[], days: number, levels: number): GroupStat {
  const finished = rounds.filter((r) => r.wonAt !== STOPPED);
  const share = (count: number) => (finished.length ? (count / finished.length) * 100 : 0);
  return {
    days,
    roundsPerDay: days ? rounds.length / days : 0,
    firstWinPct: share(finished.filter((r) => r.wonAt === 0).length),
    ends: [...Array.from({ length: levels + 1 }, (_, level) => share(finished.filter((r) => r.wonAt === level).length)), share(finished.filter((r) => r.wonAt === LOST).length)],
    profitPerDay: days ? sum(rounds.map((r) => r.profit)) / days : 0,
  };
}

/**
 * Everything the report shows for one setting. `days` are the Bangkok days of the test; rounds
 * outside them are ignored. `hours` are the Bangkok hours the setting may start rounds in.
 */
export function summarize(rounds: readonly Round[], days: readonly string[], levels: number, hours?: readonly boolean[]): Summary {
  // Bangkok day of a round by arithmetic (a date string per round is slow over millions of rounds)
  const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const index = new Map(days.map((d, i) => [dayNumber(d), i]));
  const dayOf = (r: Round) => index.get(Math.floor((r.start + BANGKOK_OFFSET_S) / 86_400));
  const inPeriod = rounds.filter((r) => dayOf(r) !== undefined);
  const finished = inPeriod.filter((r) => r.wonAt !== STOPPED);
  const won = finished.filter((r) => r.wonAt >= 0).length;
  const lost = finished.filter((r) => r.wonAt === LOST).length;
  const wonAtLevel = Array.from({ length: levels + 1 }, (_, level) => finished.filter((r) => r.wonAt === level).length);
  const profit = sum(inPeriod.map((r) => r.profit));

  const daily = days.map((d) => ({ day: d, rounds: 0, profit: 0 }));
  for (const r of inPeriod) {
    const entry = daily[dayOf(r)!]!;
    entry.rounds++;
    entry.profit += r.profit;
  }
  const worst = daily.reduce<{ day: string; profit: number } | null>((w, d) => (w === null || d.profit < w.profit ? { day: d.day, profit: d.profit } : w), null);

  const hourStat = hourStats(finished, profit / Math.max(1, inPeriod.length));
  const openHours = hours ? hours.filter(Boolean).length : 24;
  const checkSplit = Math.max(0, days.length - CHECK_DAYS);
  const before = periodStat(inPeriod.filter((r) => dayOf(r)! < checkSplit), checkSplit);
  const last = periodStat(inPeriod.filter((r) => dayOf(r)! >= checkSplit), days.length - checkSplit);

  return {
    days: days.length,
    rounds: inPeriod.length,
    roundsPerDay: inPeriod.length / Math.max(1, days.length),
    roundsPerHour: inPeriod.length / Math.max(1, days.length * openHours),
    quietMinutes: quietMinutes(inPeriod, hours),
    roundWinPct: finished.length ? (won / finished.length) * 100 : 0,
    firstWinPct: finished.length ? ((wonAtLevel[0] ?? 0) / finished.length) * 100 : 0,
    wonAtLevel,
    lost,
    stopped: inPeriod.length - finished.length,
    fullLossEveryDays: lost ? days.length / lost : null,
    profit,
    profitPerDay: profit / Math.max(1, days.length),
    losingDays: daily.filter((d) => d.profit < 0).length,
    worstDay: worst && worst.profit < 0 ? worst : null,
    biggestDrop: biggestDrop(inPeriod),
    mostAtOnce: mostAtOnce(inPeriod),
    hours: hourStat,
    goodHours: hourRanges(hourStat, "good"),
    avoidHours: hourRanges(hourStat, "avoid"),
    daily,
    parts: dayParts(days).map(({ from, to, first, last }) =>
      partStat(finished.filter((r) => dayOf(r)! >= first && dayOf(r)! <= last), from, to, last - first + 1, levels),
    ),
    // Held up: the last 2 weeks still made money, at least half as much per round as before
    check: { before, last, heldUp: last.profitPerRound > 0 && last.profitPerRound >= before.profitPerRound * 0.5 },
  };
}

/** How many equal stretches "does it hold over time?" cuts the test into. */
export const PARTS = 4;

export interface PartStat {
  /** First and last Bangkok day of the stretch. */
  from: string;
  to: string;
  roundsPerDay: number;
  firstWinPct: number;
  /** Share of finished rounds won by the first order, martingale 1 … levels, then lost all, in percent. */
  ends: number[];
}

/** The days cut into PARTS stretches as equal as possible, oldest first (index range and dates). */
export function dayParts(days: readonly string[]): { from: string; to: string; first: number; last: number }[] {
  const parts = Math.min(PARTS, days.length);
  return Array.from({ length: parts }, (_, p) => {
    const first = Math.floor((p * days.length) / parts);
    const last = Math.floor(((p + 1) * days.length) / parts) - 1;
    return { from: days[first]!, to: days[last]!, first, last };
  });
}

function partStat(finished: readonly Round[], from: string, to: string, days: number, levels: number): PartStat {
  const share = (n: number) => (finished.length ? (n / finished.length) * 100 : 0);
  return {
    from,
    to,
    roundsPerDay: finished.length / days,
    firstWinPct: share(finished.filter((r) => r.wonAt === 0).length),
    ends: [...Array.from({ length: levels + 1 }, (_, level) => share(finished.filter((r) => r.wonAt === level).length)), share(finished.filter((r) => r.wonAt === LOST).length)],
  };
}

function periodStat(inDays: readonly Round[], days: number): PeriodStat {
  const finished = inDays.filter((r) => r.wonAt !== STOPPED);
  const profit = sum(inDays.map((r) => r.profit));
  return {
    days,
    rounds: inDays.length,
    roundWinPct: finished.length ? (finished.filter((r) => r.wonAt >= 0).length / finished.length) * 100 : 0,
    firstWinPct: finished.length ? (finished.filter((r) => r.wonAt === 0).length / finished.length) * 100 : 0,
    profitPerDay: days ? profit / days : 0,
    profitPerRound: inDays.length ? profit / inDays.length : 0,
  };
}

/**
 * Per Bangkok hour of the round's start. good: earns at least the average per round; ok: earns, but
 * less; avoid: loses money; few: not enough rounds to tell.
 */
function hourStats(rounds: readonly Round[], averagePerRound: number): HourStat[] {
  const stats: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({ hour, rounds: 0, won: 0, firstWon: 0, profit: 0, status: "few" }));
  for (const r of rounds) {
    const s = stats[bangkokHour(r.start)]!;
    s.rounds++;
    if (r.wonAt >= 0) s.won++;
    if (r.wonAt === 0) s.firstWon++;
    s.profit += r.profit;
  }
  for (const s of stats) {
    if (s.rounds < MIN_ROUNDS_PER_HOUR) s.status = "few";
    else if (s.profit <= 0) s.status = "avoid";
    else if (s.profit / s.rounds >= averagePerRound) s.status = "good";
    else s.status = "ok";
  }
  return stats;
}

/** Neighbouring hours with the status, as "07-11" (11:00 excluded). */
export function hourRanges(hours: readonly HourStat[], status: HourStatus): string[] {
  const ranges: string[] = [];
  let start = -1;
  for (let h = 0; h <= 24; h++) {
    const matches = h < 24 && hours[h]!.status === status;
    if (matches && start < 0) start = h;
    if (!matches && start >= 0) {
      ranges.push(`${pad(start)}-${pad(h)}`);
      start = -1;
    }
  }
  return ranges;
}

/**
 * The wait between minutes in which new rounds start (any asset), that 9 in 10 waits stay under.
 * A wait that crosses an hour the setting does not trade is the break, not a quiet stretch.
 */
function quietMinutes(rounds: readonly Round[], hours: readonly boolean[] | undefined): number | null {
  const minutes = [...new Set(rounds.map((r) => Math.floor(r.start / 60)))].sort((a, b) => a - b);
  const waits: number[] = [];
  for (let i = 1; i < minutes.length; i++) {
    const from = minutes[i - 1]!;
    const to = minutes[i]!;
    if (hours && !allOpen(from * 60, to * 60, hours)) continue;
    waits.push(to - from);
  }
  if (!waits.length) return null;
  waits.sort((a, b) => a - b);
  return waits[Math.min(waits.length - 1, Math.ceil(waits.length * QUIET_SHARE) - 1)]!;
}

/** Every Bangkok hour from `from` to `to` (unix seconds) is one the setting trades. */
function allOpen(from: number, to: number, hours: readonly boolean[]): boolean {
  for (let t = from - (from % 3600); t <= to; t += 3600) if (!hours[bangkokHour(t)]) return false;
  return true;
}

/** Running total in the order rounds finish; the deepest fall below an earlier high. */
function biggestDrop(rounds: readonly Round[]): number {
  let total = 0;
  let peak = 0;
  let drop = 0;
  for (const r of [...rounds].sort((a, b) => a.end - b.end)) {
    total += r.profit;
    peak = Math.max(peak, total);
    drop = Math.min(drop, total - peak);
  }
  return drop;
}

function mostAtOnce(rounds: readonly Round[]): number {
  const events: [number, number][] = [];
  for (const r of rounds) events.push([r.start, 1], [r.end, -1]);
  // A round ending at the same second another starts does not overlap it
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  let most = 0;
  for (const [, change] of events) {
    open += change;
    most = Math.max(most, open);
  }
  return most;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}
