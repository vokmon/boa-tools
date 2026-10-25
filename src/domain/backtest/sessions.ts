import { nextStake, worstCaseStake, type MartingaleSettings, type OrderSettings } from "./martingale";
import { BANGKOK_OFFSET_S, type Round } from "./rounds";
import { CHECK_DAYS, dayParts } from "./summary";

/**
 * How we trade: a session ends at whichever comes first, its time, its take-profit or its stop-loss.
 * Both stops are optional; without them a session only ends at its time.
 */
export interface SessionRule {
  minutes: number;
  /** Stop once the session is up this many times the first order (10 = 300 THB at 30 THB). */
  takeProfitMultiplier?: number;
  /** Stop once the session is down as much as this many fully lost rounds. */
  stopLossRounds?: number;
}

export type SessionEnd = "takeProfit" | "stopLoss" | "time";

/** One session: started at a Bangkok hour on a Bangkok day. */
export interface Session {
  day: string;
  hour: number;
  rounds: number;
  profit: number;
  /** null when no round started in the session. */
  endedBy: SessionEnd | null;
  /** Minutes from the start until it ended (a stop, or its time). */
  minutes: number;
}

const HOURS = 24;

/** "60 min · take-profit 10x the first order · stop-loss 1 lost round" */
export function sessionLabel(rule: SessionRule): string {
  return [
    `${rule.minutes} min`,
    rule.takeProfitMultiplier ? `take-profit ${rule.takeProfitMultiplier}x the first order` : "no take-profit",
    rule.stopLossRounds ? `stop-loss ${rule.stopLossRounds} lost round${rule.stopLossRounds > 1 ? "s" : ""}` : "no stop-loss",
  ].join(" · ");
}

export interface SessionStops {
  takeProfit: number | null;
  /** Negative. */
  stopLoss: number | null;
  /** Money lost after the first n orders of a round lost (index n), to cut a running chain short. */
  lossAfter: number[];
}

/**
 * What happens to martingale chains still running when a session ends: "finish" lets them play out
 * (the money of the whole round counts), "stop" places no further order (only the orders already
 * placed count).
 */
export type OpenChains = "finish" | "stop";

/** The two stops in THB for this martingale and order. */
export function sessionStops(rule: SessionRule, martingale: MartingaleSettings, order: OrderSettings): SessionStops {
  const lossAfter = [0];
  let stake = order.amount;
  for (let level = 0; level <= martingale.levels; level++) {
    lossAfter.push(lossAfter.at(-1)! + stake);
    stake = nextStake(stake, lossAfter.at(-1)!, martingale, order);
  }
  return {
    takeProfit: rule.takeProfitMultiplier ? rule.takeProfitMultiplier * order.amount : null,
    stopLoss: rule.stopLossRounds ? -rule.stopLossRounds * worstCaseStake(martingale, order) : null,
    lossAfter,
  };
}

/**
 * Plays a session starting at every Bangkok hour of every day. In a session, rounds start as the
 * signal fires; the running total changes as each round finishes. Once it reaches the take-profit
 * or the stop-loss, or the time is up, no new round starts; rounds already running finish and count.
 * Each session starts with a fresh total: a round started before the session is not part of it.
 * `rounds` are of one setting and asset group, in any order.
 */
export function playSessions(rounds: readonly Round[], days: readonly string[], rule: SessionRule, stops: SessionStops, chains: OpenChains = "finish"): Session[] {
  const byStart = [...rounds].sort((a, b) => a.start - b.start);
  const starts = byStart.map((r) => r.start);
  const sessions: Session[] = [];
  for (const day of days) {
    const dayStart = Date.parse(`${day}T00:00:00Z`) / 1000 - BANGKOK_OFFSET_S;
    for (let hour = 0; hour < HOURS; hour++) {
      const from = dayStart + hour * 3600;
      const to = from + rule.minutes * 60;
      sessions.push({ day, hour, ...playOne(byStart, lowerBound(starts, from), to, from, stops, chains) });
    }
  }
  return sessions;
}

function playOne(byStart: readonly Round[], first: number, to: number, from: number, stops: SessionStops, chains: OpenChains): Omit<Session, "day" | "hour"> {
  let total = 0;
  let count = 0;
  let stoppedBy: SessionEnd | null = null;
  let stoppedAt = to;
  // Rounds that started, waiting to finish
  const open: Round[] = [];
  /** Adds the rounds finished by `time`, in the order they finish, until a stop is reached. */
  const settleUntil = (time: number) => {
    open.sort((a, b) => a.end - b.end);
    while (stoppedBy === null && open.length && open[0]!.end <= time) {
      const r = open.shift()!;
      total += r.profit;
      if (stops.takeProfit !== null && total >= stops.takeProfit) stoppedBy = "takeProfit";
      else if (stops.stopLoss !== null && total <= stops.stopLoss) stoppedBy = "stopLoss";
      if (stoppedBy !== null) stoppedAt = r.end;
    }
  };
  for (let i = first; i < byStart.length && byStart[i]!.start < to; i++) {
    const r = byStart[i]!;
    settleUntil(r.start);
    if (stoppedBy !== null) break;
    open.push(r);
    count++;
  }
  settleUntil(to);
  if (count === 0) return { rounds: 0, profit: 0, endedBy: null, minutes: 0 };
  // Rounds still running when the session ended
  for (const r of open) {
    if (chains === "finish" || r.end <= stoppedAt) {
      total += r.profit;
      continue;
    }
    // Only the orders already placed count; a round still running has lost each of them
    // (a draw, which repeats an order, is counted as a level here)
    const placed = Math.floor((stoppedAt - r.start) / 60) + 1;
    total += placed >= r.orders ? r.profit : -stops.lossAfter[Math.min(placed, stops.lossAfter.length - 1)]!;
  }
  return { rounds: count, profit: total, endedBy: stoppedBy ?? "time", minutes: (stoppedAt - from) / 60 };
}

/** First index whose value is >= x. */
function lowerBound(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How sessions of one kind ended: their share of the sessions, average result and minutes. */
export interface EndStat {
  pct: number;
  /** Of all sessions, the share that ended this way in profit, and with a loss (or level); together pct. */
  wonPct: number;
  lostPct: number;
  /** The lowest and highest result of these sessions; 0 when there were none. */
  lowest: number;
  highest: number;
  /** "1 in N sessions"; null when none ended this way. */
  oneIn: number | null;
  averageProfit: number;
  averageMinutes: number;
}

export interface SessionSummary {
  rule: SessionRule;
  /** The stops in THB: take-profit, and stop-loss as a negative number. */
  takeProfit: number | null;
  stopLoss: number | null;
  /** Sessions with at least one round; the rest had nothing to trade (N/A). */
  sessions: number;
  empty: number;
  averageProfit: number;
  inProfitPct: number;
  best: number;
  worst: number;
  averageRounds: number;
  ended: Record<SessionEnd, EndStat>;
  /** The newest 2 weeks on their own. */
  last2Weeks: { sessions: number; averageProfit: number; inProfitPct: number };
  /** Per Bangkok start hour, best average first; hours without sessions are left out. */
  hours: { hour: number; sessions: number; averageProfit: number; inProfitPct: number; worst: number }[];
  /** 20 sessions picked at random, many times: the middle 80% of their totals, and the average. */
  after20: { low: number; high: number; average: number } | null;
  /** The same stretches of days as Summary.parts: the sessions in each. */
  parts: { from: string; to: string; sessions: number; averageProfit: number; inProfitPct: number }[];
  /** The same sessions if martingale chains still running at the end were stopped instead of finished. */
  ifChainsStopped?: { averageProfit: number; inProfitPct: number; worst: number };
}

/** Average, share won and worst of the sessions that had something to trade. */
export function sessionResult(all: readonly Session[]): { averageProfit: number; inProfitPct: number; worst: number } {
  const played = all.filter((s) => s.endedBy !== null);
  if (!played.length) return { averageProfit: 0, inProfitPct: 0, worst: 0 };
  return {
    averageProfit: played.reduce((n, s) => n + s.profit, 0) / played.length,
    inProfitPct: (played.filter((s) => s.profit > 0).length / played.length) * 100,
    worst: Math.min(...played.map((s) => s.profit)),
  };
}

const PICKED = 20;
const TRIES = 2000;

export function summarizeSessions(all: readonly Session[], rule: SessionRule, stops: SessionStops, days: readonly string[]): SessionSummary {
  const played = all.filter((s) => s.endedBy !== null);
  const average = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const inProfit = (xs: readonly Session[]) => (xs.length ? (xs.filter((s) => s.profit > 0).length / xs.length) * 100 : 0);
  const ended = (by: SessionEnd): EndStat => {
    const these = played.filter((s) => s.endedBy === by);
    const share = (n: number) => (played.length ? (n / played.length) * 100 : 0);
    const won = these.filter((s) => s.profit > 0).length;
    return {
      pct: share(these.length),
      wonPct: share(won),
      lostPct: share(these.length - won),
      lowest: these.length ? Math.min(...these.map((s) => s.profit)) : 0,
      highest: these.length ? Math.max(...these.map((s) => s.profit)) : 0,
      oneIn: these.length ? played.length / these.length : null,
      averageProfit: average(these.map((s) => s.profit)),
      averageMinutes: average(these.map((s) => s.minutes)),
    };
  };
  const checkFrom = days[Math.max(0, days.length - CHECK_DAYS)] ?? "";
  const last = played.filter((s) => s.day >= checkFrom);
  const hours = Array.from({ length: HOURS }, (_, hour) => {
    const these = played.filter((s) => s.hour === hour);
    return { hour, sessions: these.length, averageProfit: average(these.map((s) => s.profit)), inProfitPct: inProfit(these), worst: Math.min(0, ...these.map((s) => s.profit)) };
  })
    .filter((h) => h.sessions > 0)
    .sort((a, b) => b.averageProfit - a.averageProfit);

  return {
    rule,
    takeProfit: stops.takeProfit,
    stopLoss: stops.stopLoss,
    sessions: played.length,
    empty: all.length - played.length,
    averageProfit: average(played.map((s) => s.profit)),
    inProfitPct: inProfit(played),
    best: played.length ? Math.max(...played.map((s) => s.profit)) : 0,
    worst: played.length ? Math.min(...played.map((s) => s.profit)) : 0,
    averageRounds: average(played.map((s) => s.rounds)),
    ended: { takeProfit: ended("takeProfit"), stopLoss: ended("stopLoss"), time: ended("time") },
    last2Weeks: { sessions: last.length, averageProfit: average(last.map((s) => s.profit)), inProfitPct: inProfit(last) },
    hours,
    after20: after20(played.map((s) => s.profit)),
    parts: dayParts(days).map(({ from, to }) => {
      const these = played.filter((s) => s.day >= from && s.day <= to);
      return { from, to, sessions: these.length, averageProfit: average(these.map((s) => s.profit)), inProfitPct: inProfit(these) };
    }),
  };
}

/** Totals of 20 random sessions, repeated: the 10th and 90th percentile, and their average. */
function after20(profits: readonly number[]): SessionSummary["after20"] {
  if (profits.length === 0) return null;
  const random = seeded(profits.length);
  const totals = Array.from({ length: TRIES }, () => {
    let total = 0;
    for (let i = 0; i < PICKED; i++) total += profits[Math.floor(random() * profits.length)]!;
    return total;
  }).sort((a, b) => a - b);
  return { low: totals[Math.floor(TRIES * 0.1)]!, high: totals[Math.floor(TRIES * 0.9)]!, average: totals.reduce((a, b) => a + b, 0) / TRIES };
}

/** Small seeded random generator (mulberry32), so the same run gives the same range. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
