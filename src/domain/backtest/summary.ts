import { BANGKOK_OFFSET_S, LOST, STOPPED, bangkokHour, type Round } from "./rounds";

/**
 * An hour needs at least this many rounds before it is called good or bad; with fewer, a couple of
 * lost rounds decide the hour and the good / avoid pattern is noise.
 */
export const MIN_ROUNDS_PER_HOUR = 100;
/** Days at the end used for the "last 2 weeks" check. */
export const CHECK_DAYS = 14;

export type HourStatus = "good" | "ok" | "avoid" | "few";

export interface HourStat {
  hour: number;
  rounds: number;
  won: number;
  profit: number;
  status: HourStatus;
}

export interface PeriodStat {
  days: number;
  rounds: number;
  roundWinPct: number;
  profitPerDay: number;
  profitPerRound: number;
}

export interface Summary {
  days: number;
  rounds: number;
  roundsPerDay: number;
  /** Rounds that ended in a win at any level, in percent of rounds that finished. */
  roundWinPct: number;
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
  /** The last 2 weeks against the days before them. */
  check: { before: PeriodStat; last: PeriodStat; heldUp: boolean };
}

/**
 * Everything the report shows for one setting. `days` are the Bangkok days of the test; rounds
 * outside them are ignored.
 */
export function summarize(rounds: readonly Round[], days: readonly string[], levels: number): Summary {
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

  const hours = hourStats(finished, profit / Math.max(1, inPeriod.length));
  const checkSplit = Math.max(0, days.length - CHECK_DAYS);
  const before = periodStat(inPeriod.filter((r) => dayOf(r)! < checkSplit), checkSplit);
  const last = periodStat(inPeriod.filter((r) => dayOf(r)! >= checkSplit), days.length - checkSplit);

  return {
    days: days.length,
    rounds: inPeriod.length,
    roundsPerDay: inPeriod.length / Math.max(1, days.length),
    roundWinPct: finished.length ? (won / finished.length) * 100 : 0,
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
    hours,
    goodHours: hourRanges(hours, "good"),
    avoidHours: hourRanges(hours, "avoid"),
    daily,
    // Held up: the last 2 weeks still made money, at least half as much per round as before
    check: { before, last, heldUp: last.profitPerRound > 0 && last.profitPerRound >= before.profitPerRound * 0.5 },
  };
}

function periodStat(inDays: readonly Round[], days: number): PeriodStat {
  const finished = inDays.filter((r) => r.wonAt !== STOPPED);
  const profit = sum(inDays.map((r) => r.profit));
  return {
    days,
    rounds: inDays.length,
    roundWinPct: finished.length ? (finished.filter((r) => r.wonAt >= 0).length / finished.length) * 100 : 0,
    profitPerDay: days ? profit / days : 0,
    profitPerRound: inDays.length ? profit / inDays.length : 0,
  };
}

/**
 * Per Bangkok hour of the round's start. good: earns at least the average per round; ok: earns, but
 * less; avoid: loses money; few: not enough rounds to tell.
 */
function hourStats(rounds: readonly Round[], averagePerRound: number): HourStat[] {
  const stats: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({ hour, rounds: 0, won: 0, profit: 0, status: "few" }));
  for (const r of rounds) {
    const s = stats[bangkokHour(r.start)]!;
    s.rounds++;
    if (r.wonAt >= 0) s.won++;
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
