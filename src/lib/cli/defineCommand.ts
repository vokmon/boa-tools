import { parseArgs } from "node:util";
import { logger } from "../logger";
import { runCli } from "./runCli";
import { UsageError } from "./UsageError";

interface BaseOption {
  description: string;
  short?: string;
}
export interface StringOption extends BaseOption {
  type: "string";
  /** Placeholder shown in help, e.g. "dd/mm/yyyy" renders as `--from <dd/mm/yyyy>`. */
  placeholder?: string;
  default?: string;
}
export interface BooleanOption extends BaseOption {
  type: "boolean";
  /** Without a default the value is undefined when neither --x nor --no-x is passed, so it can be asked. */
  default?: boolean;
}
export type OptionDefinitions = Record<string, StringOption | BooleanOption>;

/** Parsed values: booleans are always set, strings are set when given or defaulted. */
export type OptionValues<D extends OptionDefinitions> = {
  [K in keyof D]: D[K] extends BooleanOption
    ? D[K] extends { default: boolean }
      ? boolean
      : boolean | undefined
    : D[K] extends { default: string }
      ? string
      : string | undefined;
};

export interface CommandDefinition<D extends OptionDefinitions> {
  /** The `bun run <name>` script name. */
  name: string;
  /** One or more lines describing what the command does. */
  description: string;
  /** Example invocations shown under Usage. */
  examples?: string[];
  options: D;
  /** Settings the command reads from .env, listed under "Environment" in the help. */
  env?: EnvVar[];
  /** Extra text at the end of the help, e.g. notes or caveats. */
  notes?: string;
  run: (values: OptionValues<D>) => Promise<void>;
}

export interface EnvVar {
  name: string;
  description: string;
  /** Shown as "(default …)"; without it the variable is required. */
  default?: string;
  /** Optional with no default (e.g. only needed by some runs). */
  optional?: boolean;
}

/** Options every command gets for free. */
const BUILT_IN = {
  verbose: { type: "boolean", description: "show debug logging", default: false },
  help: { type: "boolean", short: "h", description: "show this help", default: false },
} as const satisfies OptionDefinitions;

/** Help text generated from the option definitions, so it always matches what is parsed. */
export function formatHelp<D extends OptionDefinitions>(command: Omit<CommandDefinition<D>, "run">): string {
  const all: OptionDefinitions = { ...command.options, ...BUILT_IN };
  const flags = Object.entries(all).map(([name, option]) => {
    const short = option.short ? `-${option.short}, ` : "    ";
    const value = option.type === "string" ? ` <${option.placeholder ?? "value"}>` : "";
    const negatable = option.type === "boolean" && option.default === undefined;
    return { flag: `  ${short}--${negatable ? "[no-]" : ""}${name}${value}`, option };
  });
  const width = Math.max(...flags.map((f) => f.flag.length)) + 3;
  const optionLines = flags.map(({ flag, option }) => {
    const fallback = option.type === "string" && option.default !== undefined ? ` (default ${option.default})` : "";
    return `${flag.padEnd(width)}${option.description}${fallback}`;
  });

  const envWidth = Math.max(0, ...(command.env ?? []).map((v) => v.name.length)) + 5;
  const envLines = (command.env ?? []).map((v) => {
    const need = v.default !== undefined ? `(default ${v.default})` : v.optional ? "(optional)" : "(required)";
    return `  ${v.name.padEnd(envWidth - 2)}${v.description} ${need}`;
  });

  const examples = command.examples?.length ? command.examples : [`bun run ${command.name} [options]`];
  return [
    command.description.trim(),
    "",
    "Usage:",
    ...examples.map((e) => `  ${e}`),
    "",
    "Options:",
    ...optionLines,
    ...(envLines.length ? ["", "Environment (.env):", ...envLines] : []),
    ...(command.notes ? ["", command.notes.trim()] : []),
  ].join("\n");
}

/** Parses argv against the definitions. Throws UsageError for unknown or malformed flags. */
export function parseCommandArgs<D extends OptionDefinitions>(
  options: D,
  argv: string[],
): OptionValues<D> & { help: boolean; verbose: boolean } {
  const all: OptionDefinitions = { ...options, ...BUILT_IN };
  // node:util parseArgs rejects keys that are present but undefined, so only set what exists.
  const config = Object.fromEntries(
    Object.entries(all).map(([name, o]) => {
      const entry: { type: "string" | "boolean"; short?: string; default?: string | boolean } = { type: o.type };
      if (o.short) entry.short = o.short;
      if (o.default !== undefined) entry.default = o.default;
      return [name, entry];
    }),
  );
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: config,
      strict: true,
      allowPositionals: true,
      allowNegative: true,
    });
    if (positionals.length) throw new Error(`unexpected argument(s): ${positionals.join(" ")}`);
    return values as OptionValues<D> & { help: boolean; verbose: boolean };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Declares and runs a command: parses flags, handles --help and --verbose, and reports
 * errors through `runCli`. Call it as the last line of a tool's entry file.
 */
export function defineCommand<D extends OptionDefinitions>(command: CommandDefinition<D>, argv = Bun.argv.slice(2)): void {
  const help = formatHelp(command);
  runCli(async () => {
    const values = parseCommandArgs(command.options, argv);
    if (values.help) {
      console.log(help);
      return;
    }
    if (values.verbose) logger.setLevel("debug");
    await command.run(values);
  }, help);
}
