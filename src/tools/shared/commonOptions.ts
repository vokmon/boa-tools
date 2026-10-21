import type { SentryProject } from "@/clients/sentry/types";
import { askParsed, chooseMany, resolveOption } from "@/lib/cli";
import { parseDayMonthYear } from "@/lib/date";

/** Normalises dd/mm/yyyy so "1/9/2026" works too; throws a readable error when invalid. */
export function parseDate(raw: string): string {
  const { day, month, year } = parseDayMonthYear(raw);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function toUtcDay(ddmmyyyy: string): number {
  const { day, month, year } = parseDayMonthYear(ddmmyyyy);
  return Date.UTC(year, month - 1, day);
}

export interface DateRangeOptions {
  from: string | undefined;
  to: string | undefined;
  /** Shown as the prompt default for --from. */
  defaultFrom: string;
  /** Default for --to, in the prompt and when it is omitted without a terminal. Usually today. */
  defaultTo: string;
  /** Use defaultFrom instead of failing when --from is omitted without a terminal. */
  fromDefaultsWithoutTerminal?: boolean;
}

/** --from / --to as flags or prompts; `to` must not be before `from`. */
export async function resolveDateRange(options: DateRangeOptions): Promise<{ from: string; to: string }> {
  const from = await resolveOption({
    flag: "--from",
    value: options.from,
    parse: parseDate,
    ask: () => askParsed("From (dd/mm/yyyy):", parseDate, { default: options.defaultFrom }),
    fallback: options.fromDefaultsWithoutTerminal ? () => options.defaultFrom : undefined,
  });
  const defaultTo = options.defaultTo;
  const parseTo = (raw: string) => {
    const to = parseDate(raw);
    if (toUtcDay(to) < toUtcDay(from)) throw new Error(`must be on or after ${from}`);
    return to;
  };
  const to = await resolveOption({
    flag: "--to",
    value: options.to,
    parse: parseTo,
    ask: () => askParsed("To (dd/mm/yyyy):", parseTo, { default: defaultTo }),
    fallback: () => defaultTo,
  });
  return { from, to };
}

/** "all" or comma-separated slugs, validated against the projects the token can see. */
export function parseProjects(raw: string, available: SentryProject[]): SentryProject[] {
  if (raw.trim() === "all") return available;
  const slugs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = slugs.filter((s) => !available.some((p) => p.slug === s));
  if (slugs.length === 0 || unknown.length) {
    throw new Error(`unknown project(s): ${unknown.join(", ") || "none given"}. Available: ${available.map((p) => p.slug).join(", ")}`);
  }
  return available.filter((p) => slugs.includes(p.slug));
}

/** --project as a flag, or an arrow-key multi-select with nothing preselected. */
export async function resolveSentryProjects(flag: string | undefined, available: SentryProject[]): Promise<SentryProject[]> {
  if (available.length === 0) throw new Error("The Sentry token cannot see any projects");
  return resolveOption({
    flag: "--project",
    value: flag,
    parse: (raw) => parseProjects(raw, available),
    ask: () => chooseMany("Which Sentry projects count as app usage?", available.map((p) => ({ name: p.slug, value: p }))),
  });
}
