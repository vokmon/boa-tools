import { ROUNDS_PER_DAY_GOAL } from "@/domain/backtest/summary";
import type { SettingResult } from "../runBacktest";
import { defaultValues } from "../settings/settingsFile";

/** First-order win rate needed to break even at this payout, in percent (54.05 at 85%). */
export function breakEvenPct(payout: number): number {
  return 100 / (1 + payout / 100);
}

/** 1240.5 -> "+1,241", -95 -> "-95" */
export function money(n: number): string {
  const rounded = Math.round(n);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`;
}

export function percent(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** Share of finished rounds, e.g. "58%"; "<1%" for small non-zero values. */
export function share(count: number, total: number): string {
  if (total === 0 || count === 0) return "0%";
  const p = (count / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** "1 per 4.2 days", or "never". */
export function fullLossEvery(days: number | null): string {
  if (days === null) return "never";
  return days < 1 ? `${(1 / days).toFixed(1)} per day` : `1 per ${days.toFixed(1)} days`;
}

/** "07-11, 20-23" or "-". */
export function hourList(ranges: readonly string[]): string {
  return ranges.length ? ranges.join(", ") : "-";
}

/** "✅ 55.2% +310/day" or "⚠️ 50.9% -4,321/day": the last 2 weeks' first-order win and profit, and whether they held up. */
export function checkCell(r: SettingResult): string {
  const last = r.summary.check.last;
  return `${r.summary.check.heldUp ? "✅" : "⚠️ "} ${percent(last.firstWinPct)} ${money(last.profitPerDay)}/day`;
}

/** "✅ 827" inside the rounds-a-day goal, "⚠️ 175" outside it. */
export function roundsCell(roundsPerDay: number): string {
  return `${inRoundsGoal(roundsPerDay) ? "✅" : "⚠️ "} ${roundsPerDay.toFixed(0)}`;
}

export function inRoundsGoal(roundsPerDay: number): boolean {
  return roundsPerDay >= ROUNDS_PER_DAY_GOAL.min && roundsPerDay <= ROUNDS_PER_DAY_GOAL.max;
}

/** "5 min", or "-" without two rounds to measure. */
export function quietCell(minutes: number | null): string {
  return minutes === null ? "-" : `${minutes} min`;
}

/** Finished rounds (won + lost), the base for the "won at level" shares. */
export function finishedRounds(r: SettingResult): number {
  return r.summary.rounds - r.summary.stopped;
}

/** Values that differ from the bot's current settings, e.g. "bollinger.period 14→20". */
export function changesFromBot(values: Record<string, unknown>): string[] {
  const defaults = defaultValues();
  return Object.entries(values)
    .filter(([path, v]) => (path in defaults ? defaults[path] !== v : path === "hours"))
    .map(([path, v]) => (path === "hours" ? `hours ${(v as string[]).join(", ")}` : `${path} ${defaults[path]}→${v}`));
}

/** The bot's own settings first, then the rest by profit per day. */
export function ordered(results: readonly SettingResult[]): SettingResult[] {
  const isBot = (r: SettingResult) => changesFromBot(r.setting.values).length === 0;
  return [...results].sort((a, b) => Number(isBot(b)) - Number(isBot(a)) || b.summary.profitPerDay - a.summary.profitPerDay);
}

/** Settings-file JSON for a resolved setting, every value written out (same shape as bot-current.json). */
export function settingsFileJson(values: Record<string, unknown>, note?: string): Record<string, unknown> {
  const out: Record<string, unknown> = note ? { note } : {};
  for (const [path, v] of Object.entries(values)) {
    if (path === "hours") continue;
    const [group, key] = path.split(".") as [string, string];
    out[group] = { ...((out[group] as object) ?? {}), [key]: v };
  }
  if (values.hours) out.hours = values.hours;
  return out;
}
