import { checkbox, confirm, input, select } from "@inquirer/prompts";

/** Prompts render on stderr so stdout stays clean for report output. */
const context = { output: process.stderr };

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
  checked?: boolean;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/**
 * Free-text prompt whose answer is run through `parse`. A parse error is shown inline and the
 * user can retry, so the returned value is always valid.
 */
export async function askParsed<T>(message: string, parse: (raw: string) => T, options: { default?: string } = {}): Promise<T> {
  const raw = await input(
    {
      message,
      default: options.default,
      validate: (value) => {
        try {
          parse(value);
          return true;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    },
    context,
  );
  return parse(raw);
}

/** Single choice with arrow keys and enter. */
export async function chooseOne<T>(message: string, choices: Choice<T>[], options: { default?: T } = {}): Promise<T> {
  return select({ message, choices, default: options.default, loop: false, pageSize: Math.max(choices.length, 7) }, context);
}

/** Multiple choice: arrow keys to move, space to toggle, `a` for all, enter to confirm. */
export async function chooseMany<T>(message: string, choices: Choice<T>[]): Promise<T[]> {
  return checkbox({ message, choices, required: true, loop: false, pageSize: Math.max(choices.length, 7) }, context);
}

/** Yes/no question; enter accepts the default. */
export async function askYesNo(message: string, options: { default?: boolean } = {}): Promise<boolean> {
  return confirm({ message, default: options.default ?? false }, context);
}
