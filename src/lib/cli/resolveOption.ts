import { isInteractive } from "./prompt";
import { UsageError } from "./UsageError";

/** Resolves a boolean flag (`--x` / `--no-x`) that is asked as yes/no when omitted. */
export async function resolveFlag(spec: {
  flag: string;
  value: boolean | undefined;
  ask: () => Promise<boolean>;
  fallback?: boolean;
}): Promise<boolean> {
  if (spec.value !== undefined) return spec.value;
  if (!isInteractive()) {
    if (spec.fallback !== undefined) return spec.fallback;
    throw new UsageError(`${spec.flag} or --no-${spec.flag.replace(/^--/, "")} is required when not running in a terminal`);
  }
  return spec.ask();
}

export interface OptionSpec<T> {
  /** Shown in errors, e.g. "--from". */
  flag: string;
  /** Raw value from the command line, undefined when not passed. */
  value: string | undefined;
  /** Validates and converts the raw value; throw with a readable message when invalid. */
  parse: (raw: string) => T;
  /** Asks the user when the flag is missing and a terminal is attached. */
  ask: () => Promise<T>;
  /** Used when the flag is missing and there is no terminal. Without it, that case is an error. */
  fallback?: () => T;
}

/**
 * The flag wins when given; otherwise the user is asked. Without a terminal (CI, cron, pipes)
 * a missing flag is a usage error instead of a hanging prompt.
 */
export async function resolveOption<T>(spec: OptionSpec<T>): Promise<T> {
  if (spec.value !== undefined) {
    try {
      return spec.parse(spec.value);
    } catch (error) {
      throw new UsageError(`${spec.flag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isInteractive()) {
    if (spec.fallback) return spec.fallback();
    throw new UsageError(`${spec.flag} is required when not running in a terminal`);
  }
  return spec.ask();
}
