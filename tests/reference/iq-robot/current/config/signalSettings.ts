// @ts-nocheck -- verbatim copy from iq-robot, checked under its own (looser) compiler settings
import settingsFile from "./signal-settings.json";

/** Every knob of the candle signal, grouped like signal-settings.json. See README. */
export interface SignalSettings {
  window: {
    candles: number; // closed candles per signal
    minCandles: number; // fewer candles than this always holds
  };
  supportResistance: {
    use: boolean;
    period: number;
    zone: number; // 0-1 into the upper or lower half of the box
  };
  donchian: { use: boolean; period: number };
  bollinger: { use: boolean; period: number; stdDev: number };
  stochastic: {
    use: boolean;
    k: number;
    d: number;
    smooth: number;
    kOverbought: number;
    kOversold: number;
  };
  rsi: { period: number }; // RSI must have a value, it is not a rule
  candle: {
    sameColourInARow: number;
    useShape: boolean; // the last candle must have a solid body and short wick
    minBody: number; // 0-1 of the candle's range
    maxWick: number; // 0-1 of the range, wick on the reversal side
  };
}

export const DEFAULT_SIGNAL_SETTINGS: Readonly<SignalSettings> = Object.freeze({
  window: { candles: 100, minCandles: 20 },
  supportResistance: { use: true, period: 25, zone: 0.9 },
  donchian: { use: true, period: 20 },
  bollinger: { use: true, period: 14, stdDev: 2 },
  stochastic: {
    use: true,
    k: 13,
    d: 3,
    smooth: 3,
    kOverbought: 80,
    kOversold: 20,
  },
  rsi: { period: 14 },
  candle: {
    sameColourInARow: 3,
    useShape: true,
    minBody: 0.75,
    maxWick: 0.2,
  },
});

type Kind = "count" | "number" | "share" | "level" | "switch";

// Allowed values per field; switches are recognised by their default
const KINDS: Record<string, Kind> = {
  "supportResistance.zone": "share",
  "bollinger.stdDev": "number",
  "stochastic.kOverbought": "level",
  "stochastic.kOversold": "level",
  "candle.minBody": "share",
  "candle.maxWick": "share",
};

function checkValue(kind: Kind, value: unknown): string | null {
  if (kind === "switch") {
    return typeof value === "boolean" ? null : "must be true or false";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "must be a number";
  }
  if (kind === "count" && (!Number.isInteger(value) || value < 1)) {
    return "must be a whole number of at least 1";
  }
  if (kind === "number" && value < 0) {
    return "must not be negative";
  }
  if (kind === "share" && (value < 0 || value > 1)) {
    return "must be between 0 and 1";
  }
  if (kind === "level" && (value < 0 || value > 100)) {
    return "must be between 0 and 100";
  }
  return null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fills missing values with the defaults; throws listing every invalid one. */
export function parseSignalSettings(raw: unknown): SignalSettings {
  if (!isObject(raw)) {
    throw new Error("signal-settings.json must be a JSON object");
  }
  const defaults = DEFAULT_SIGNAL_SETTINGS as unknown as Record<
    string,
    Record<string, unknown>
  >;
  const settings: Record<string, Record<string, unknown>> = {};
  const problems: string[] = [];

  for (const [group, groupDefaults] of Object.entries(defaults)) {
    settings[group] = { ...groupDefaults };
  }

  for (const [group, values] of Object.entries(raw)) {
    if (!(group in defaults)) {
      problems.push(`unknown group "${group}"`);
      continue;
    }
    if (!isObject(values)) {
      problems.push(`"${group}" must be an object`);
      continue;
    }
    for (const [name, value] of Object.entries(values)) {
      const path = `${group}.${name}`;
      if (!(name in defaults[group])) {
        problems.push(`unknown setting "${path}"`);
        continue;
      }
      const kind =
        typeof defaults[group][name] === "boolean"
          ? "switch"
          : (KINDS[path] ?? "count");
      const problem = checkValue(kind, value);
      if (problem) {
        problems.push(`"${path}" ${problem}`);
      } else {
        settings[group][name] = value;
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `signal-settings.json:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  return settings as unknown as SignalSettings;
}

export const SIGNAL_SETTINGS: Readonly<SignalSettings> = Object.freeze(
  parseSignalSettings(settingsFile),
);
