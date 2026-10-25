import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SIGNAL_SETTINGS, type SignalSettings } from "@/domain/signal";
import { DEFAULT_MARTINGALE, DEFAULT_ORDER, type MartingaleSettings, type MartingaleType, type OrderSettings } from "@/domain/backtest/martingale";
import type { SessionRule } from "@/domain/backtest/sessions";
import { CHOICE_FIELDS, FIELD_BY_PATH, NUMBER_FIELDS, type NumberField } from "./fields";

/** One fully resolved setting to backtest: a file, or one combination of the lists in a file. */
export interface RunSetting {
  /** File name without .json, plus the varied values when the file has lists. */
  label: string;
  file: string;
  note?: string;
  signal: SignalSettings;
  martingale: MartingaleSettings;
  order: OrderSettings;
  /** Bangkok hours a round may start in, or undefined for all day. */
  hours?: boolean[];
  /** How we trade: each session rule is played on its own. */
  sessions: SessionRule[];
  /** Most rounds open at once across all assets; 0 = no limit. */
  maxOpenRounds: number;
  /** Every value in settings-file form, defaults filled in, e.g. { "bollinger.period": 14, ... }. */
  values: Record<string, number | string | boolean | string[]>;
}

export class SettingsError extends Error {}

const GROUPS = new Set([...NUMBER_FIELDS.map((f) => f.path), ...Object.keys(CHOICE_FIELDS)].map((p) => p.split(".")[0]!));
const TOP_LEVEL = new Set([...GROUPS, "note", "hours", "sessions"]);
const SESSION_KEYS = ["minutes", "takeProfitMultiplier", "stopLossRounds"];

/** The values a file uses when it leaves something out: the bot's current settings. */
export function defaultValues(): Record<string, number | string | boolean> {
  const s = DEFAULT_SIGNAL_SETTINGS;
  return {
    "supportResistance.use": s.useSupportResistance,
    "supportResistance.period": s.supportResistancePeriod,
    "supportResistance.zone": s.zonePositionThreshold,
    "donchian.use": s.useDonchian,
    "donchian.period": s.donchianPeriod,
    "bollinger.use": s.useBollinger,
    "bollinger.period": s.bollingerPeriod,
    "bollinger.stdDev": s.bollingerStdDev,
    "stochastic.use": s.useStochastic,
    "stochastic.k": s.stochasticKPeriod,
    "stochastic.d": s.stochasticDPeriod,
    "stochastic.smooth": s.stochasticSmoothing,
    "stochastic.level": s.stochasticKOverbought,
    "candle.sameColourInARow": s.consecutiveCandles,
    "candle.minBody": s.minBodyRatio,
    "candle.maxWick": s.maxRejectionWickRatio,
    "candle.checkLast": s.candlesToCheckBodyAndWicks,
    "candle.minSizeVsAverage": s.minCandleSizeRatio,
    "candle.sizeCandles": s.candlesToCheckSize,
    "candle.sizeLookback": s.sizeLookback,
    "martingale.type": DEFAULT_MARTINGALE.type,
    "martingale.multiplier": DEFAULT_MARTINGALE.multiplier,
    "martingale.levels": DEFAULT_MARTINGALE.levels,
    "order.amount": DEFAULT_ORDER.amount,
    "order.payout": DEFAULT_ORDER.payout,
    // The bot trades every signal today: no limit
    "trading.maxOpenRounds": 0,
  };
}

/**
 * Validates a settings file and expands its lists into every combination. Throws a SettingsError
 * listing every problem, with the field path, so the file is easy to fix.
 */
export function parseSettingsFile(file: string, raw: unknown): RunSetting[] {
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new SettingsError(`${file}: must be a JSON object`);
  const obj = raw as Record<string, unknown>;

  const choices = new Map<string, (number | string | boolean)[]>();
  for (const [key, value] of Object.entries(obj)) {
    if (!TOP_LEVEL.has(key)) {
      problems.push(`unknown setting "${key}" (known: ${[...TOP_LEVEL].join(", ")})`);
      continue;
    }
    if (key === "note" || key === "hours" || key === "sessions") continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      problems.push(`"${key}" must be an object, e.g. { "period": 14 }`);
      continue;
    }
    for (const [sub, v] of Object.entries(value as Record<string, unknown>)) {
      const path = `${key}.${sub}`;
      const options = CHOICE_FIELDS[path];
      if (options) {
        const list = Array.isArray(v) ? v : [v];
        if (list.length === 0 || list.some((t) => !options.includes(t as string | boolean))) problems.push(`"${path}" must be ${options.map((o) => JSON.stringify(o)).join(" or ")}`);
        else choices.set(path, list as (string | boolean)[]);
        continue;
      }
      const field = FIELD_BY_PATH.get(path);
      if (!field) {
        const known = [...NUMBER_FIELDS.map((f) => f.path), ...Object.keys(CHOICE_FIELDS)].filter((p) => p.startsWith(`${key}.`)).map((p) => p.split(".")[1]);
        problems.push(`unknown setting "${path}" (known in ${key}: ${known.join(", ")})`);
        continue;
      }
      const list = Array.isArray(v) ? v : [v];
      const issue = list.length === 0 ? "is an empty list" : list.map((n) => checkNumber(field, n)).find(Boolean);
      if (issue) problems.push(`"${path}" ${issue}`);
      else choices.set(path, list as number[]);
    }
  }

  const note = obj.note;
  if (note !== undefined && typeof note !== "string") problems.push(`"note" must be text`);
  let hours: { allowed: boolean[]; text: string[] } | undefined;
  if (obj.hours !== undefined) {
    try {
      hours = parseHours(obj.hours);
    } catch (error) {
      problems.push(`"hours" ${(error as Error).message}`);
    }
  }
  const sessions = parseSessions(obj.sessions, problems);
  if (problems.length) throw new SettingsError(`${file}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  const varied = [...choices].filter(([, values]) => values.length > 1).map(([path]) => path);
  return combinations(choices).map((chosen) => {
    const values: Record<string, number | string | boolean | string[]> = { ...defaultValues(), ...chosen };
    if (hours) values.hours = hours.text;
    const setting = toRunSetting(file, values, note as string | undefined, hours?.allowed, sessions);
    if (varied.length) setting.label = `${file} [${varied.map((p) => `${p}=${chosen[p]}`).join(", ")}]`;
    return setting;
  });
}

function checkNumber(field: NumberField, n: unknown): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return `must be a number${field.integer ? " (whole)" : ""}, got ${JSON.stringify(n)}`;
  if (field.integer && !Number.isInteger(n)) return `must be a whole number, got ${n}`;
  if (n < field.min || n > field.max) return `must be between ${field.min} and ${field.max}, got ${n}`;
  return undefined;
}

function combinations(choices: Map<string, (number | string | boolean)[]>): Record<string, number | string | boolean>[] {
  let out: Record<string, number | string | boolean>[] = [{}];
  for (const [path, values] of choices) out = out.flatMap((combo) => values.map((v) => ({ ...combo, [path]: v })));
  return out;
}

/**
 * "sessions": the session rules every setting of the file is played with, e.g.
 * [{ "minutes": 60, "takeProfitMultiplier": 10, "stopLossRounds": 1 }]. Required.
 */
function parseSessions(raw: unknown, problems: string[]): SessionRule[] {
  const example = '[{ "minutes": 60, "takeProfitMultiplier": 10, "stopLossRounds": 1 }]';
  if (raw === undefined) {
    problems.push(`"sessions" is missing: list how we trade, e.g. "sessions": ${example}`);
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(`"sessions" must be a list of session rules, e.g. ${example}`);
    return [];
  }
  return raw.flatMap((rule, i): SessionRule[] => {
    const at = `"sessions"[${i}]`;
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
      problems.push(`${at} must be an object, e.g. ${example.slice(1, -1)}`);
      return [];
    }
    const r = rule as Record<string, unknown>;
    const unknown = Object.keys(r).filter((k) => !SESSION_KEYS.includes(k));
    if (unknown.length) problems.push(`${at} has unknown "${unknown.join('", "')}" (known: ${SESSION_KEYS.join(", ")})`);
    const check = (key: string, min: number, max: number, whole: boolean, required: boolean): number | undefined => {
      const v = r[key];
      if (v === undefined) {
        if (required) problems.push(`${at} needs "${key}"`);
        return undefined;
      }
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
        problems.push(`${at}.${key} must be ${whole ? "a whole number" : "a number"} between ${min} and ${max}, got ${JSON.stringify(v)}`);
        return undefined;
      }
      return v;
    };
    const minutes = check("minutes", 1, 1440, true, true);
    const takeProfitMultiplier = check("takeProfitMultiplier", 0.1, 10_000, false, false);
    const stopLossRounds = check("stopLossRounds", 0.1, 100, false, false);
    if (minutes === undefined) return [];
    return [{ minutes, ...(takeProfitMultiplier !== undefined ? { takeProfitMultiplier } : {}), ...(stopLossRounds !== undefined ? { stopLossRounds } : {}) }];
  });
}

function toRunSetting(file: string, values: Record<string, number | string | boolean | string[]>, note: string | undefined, hours: boolean[] | undefined, sessions: SessionRule[]): RunSetting {
  const signal: SignalSettings = { ...DEFAULT_SIGNAL_SETTINGS };
  for (const field of NUMBER_FIELDS) {
    for (const key of field.signal ?? []) (signal[key] as number) = values[field.path] as number;
  }
  const level = values["stochastic.level"] as number;
  signal.stochasticKOversold = 100 - level;
  signal.stochasticDOversold = 100 - level;
  signal.useSupportResistance = values["supportResistance.use"] === true;
  signal.useDonchian = values["donchian.use"] === true;
  signal.useBollinger = values["bollinger.use"] === true;
  signal.useStochastic = values["stochastic.use"] === true;
  if (signal.sizeLookback + signal.candlesToCheckSize > signal.windowSize) {
    throw new SettingsError(`${file}: candle.sizeLookback + candle.sizeCandles must be at most ${signal.windowSize}`);
  }
  return {
    label: file,
    file,
    ...(note ? { note } : {}),
    signal,
    martingale: { type: values["martingale.type"] as MartingaleType, multiplier: values["martingale.multiplier"] as number, levels: values["martingale.levels"] as number },
    order: { amount: values["order.amount"] as number, payout: values["order.payout"] as number },
    ...(hours ? { hours } : {}),
    sessions,
    maxOpenRounds: values["trading.maxOpenRounds"] as number,
    values,
  };
}

/** ["07-11", "20-23", "22-02"] -> the allowed Bangkok hours (end excluded; wraps past midnight). */
export function parseHours(raw: unknown): { allowed: boolean[]; text: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`must be a list like ["07-11", "20-23"]`);
  const allowed = new Array<boolean>(24).fill(false);
  for (const range of raw) {
    const match = typeof range === "string" ? /^(\d{1,2})-(\d{1,2})$/.exec(range.trim()) : null;
    const [from, to] = match ? [Number(match[1]), Number(match[2])] : [NaN, NaN];
    if (!match || from > 23 || to > 24 || from === to) throw new Error(`has "${String(range)}"; use "HH-HH" with hours 00-24, e.g. "07-11"`);
    for (let h = from; h !== to; h = (h + 1) % 24) {
      allowed[h] = true;
      if (to === 24 && h === 23) break;
    }
  }
  return { allowed, text: raw as string[] };
}

/** Every *.json in the folder, sorted by name, validated; one error lists every broken file. */
export async function loadSettingsFolder(dir: string): Promise<{ file: string; settings: RunSetting[] }[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    throw new SettingsError(`Settings folder ${dir} not found (BACKTEST_SETTINGS_DIR in .env)`);
  }
  if (names.length === 0) throw new SettingsError(`No settings files (*.json) in ${dir}`);
  const loaded: { file: string; settings: RunSetting[] }[] = [];
  const errors: string[] = [];
  for (const name of names) {
    const file = name.replace(/\.json$/, "");
    try {
      const text = await Bun.file(join(dir, name)).text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        throw new SettingsError(`${file}: not valid JSON (${(error as Error).message})`);
      }
      loaded.push({ file, settings: parseSettingsFile(file, raw) });
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  if (errors.length) throw new SettingsError(`Fix these settings files in ${dir}:\n${errors.join("\n")}`);
  return loaded;
}
