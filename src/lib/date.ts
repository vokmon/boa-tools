export interface DateWindow {
  start: Date;
  end: Date;
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export interface DayParts {
  year: number;
  month: number;
  day: number;
}

/** Parses dd/mm/yyyy and rejects impossible dates such as 31/02/2026. */
export function parseDayMonthYear(input: string): DayParts {
  const match = DMY.exec(input.trim());
  if (!match) throw new Error(`Invalid date "${input}", expected dd/mm/yyyy`);
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid date "${input}"`);
  }
  return { year, month, day };
}

/** Offset in ms between the wall clock in `timeZone` and UTC at the given instant. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the given wall-clock time happens in `timeZone`. */
export function zonedTimeToUtc(parts: DayParts, timeZone: string, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, ms);
  let guess = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  // A second pass settles DST transitions.
  guess = naive - timeZoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Whole-day window: start of `from` to end of `to`, inclusive, in `timeZone`. */
export function dayWindow(from: string, to: string, timeZone: string): DateWindow {
  const start = zonedTimeToUtc(parseDayMonthYear(from), timeZone);
  const end = zonedTimeToUtc(parseDayMonthYear(to), timeZone, 23, 59, 59, 999);
  if (end < start) throw new Error(`--to (${to}) is before --from (${from})`);
  return { start, end };
}

export function overlaps(window: DateWindow, start: Date, end: Date | null): boolean {
  return start <= window.end && (end === null || end >= window.start);
}

/** dd/mm/yyyy HH:mm in `timeZone`. */
export function formatDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** yyyy-mm-dd, handy for file names. */
export function isoDay(parts: DayParts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export interface Day {
  /** yyyy-mm-dd, stable key for maps and file names. */
  key: string;
  /** dd/mm/yyyy, for people. */
  label: string;
  window: DateWindow;
}

export interface Period {
  timeZone: string;
  window: DateWindow;
  days: Day[];
}

/** Every calendar day from `from` to `to` (dd/mm/yyyy, inclusive) with its own window in `timeZone`. */
export function buildPeriod(from: string, to: string, timeZone: string): Period {
  const window = dayWindow(from, to, timeZone);
  const first = parseDayMonthYear(from);
  const last = parseDayMonthYear(to);
  const days: Day[] = [];
  for (let t = Date.UTC(first.year, first.month - 1, first.day); t <= Date.UTC(last.year, last.month - 1, last.day); t += 86_400_000) {
    const d = new Date(t);
    const parts = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const label = `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${parts.year}`;
    days.push({ key: isoDay(parts), label, window: dayWindow(label, label, timeZone) });
  }
  return { timeZone, window, days };
}

/** yyyy-mm-dd of the instant as seen in `timeZone`. */
export function dayKeyOf(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** "18/10" from a yyyy-mm-dd key. */
function shortLabel(key: string): string {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

/**
 * Compact list of days, e.g. "18/10, 20/10" or "01/10 to 05/10, 08/10".
 * Runs of three or more consecutive days collapse into a range.
 */
export function compactDays(keys: readonly string[]): string {
  const sorted = [...new Set(keys)].sort();
  const parts: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const prev = Date.parse(sorted[i - 1]!);
    const consecutive = i < sorted.length && Date.parse(sorted[i]!) - prev === 86_400_000;
    if (consecutive) continue;
    const run = sorted.slice(runStart, i);
    if (run.length >= 3) parts.push(`${shortLabel(run[0]!)} to ${shortLabel(run.at(-1)!)}`);
    else parts.push(...run.map(shortLabel));
    runStart = i;
  }
  return parts.join(", ");
}

/** dd/mm/yyyy in `timeZone`. */
export function formatDate(date: Date, timeZone: string): string {
  return formatDateTime(date, timeZone).slice(0, 10);
}
