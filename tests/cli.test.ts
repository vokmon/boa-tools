import { describe, expect, test } from "bun:test";
import { resolveOption, UsageError } from "@/lib/cli";
import { renderTable, displayWidth } from "@/lib/output/table";

describe("resolveOption", () => {
  const spec = (value: string | undefined) => ({
    flag: "--n",
    value,
    parse: (raw: string) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error("must be a whole number");
      return n;
    },
    ask: async () => 42,
  });

  test("uses and parses the flag when given", async () => {
    expect(await resolveOption(spec("7"))).toBe(7);
  });

  test("turns a parse error into a UsageError naming the flag", async () => {
    const error = await resolveOption(spec("x")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe("--n: must be a whole number");
  });

  test("refuses to prompt without a terminal", async () => {
    // bun test runs without a TTY on stdin
    if (process.stdin.isTTY) return;
    expect(resolveOption(spec(undefined))).rejects.toThrow("--n is required when not running in a terminal");
  });
});

describe("renderTable", () => {
  test("aligns columns by display width, including Thai", () => {
    const lines = renderTable(
      [
        ["ณัฏฐวี", "a@x"],
        ["Bob", "b@x"],
      ],
      [{ value: (r: string[]) => r[0]! }, { value: (r: string[]) => r[1]! }],
    );
    expect(lines.map((l) => displayWidth(l.slice(0, l.indexOf("@") - 1)))).toEqual([9, 9]);
  });

  test("truncates long cells with an ellipsis", () => {
    expect(renderTable([["abcdefghij"]], [{ value: (r: string[]) => r[0]!, maxWidth: 5 }])).toEqual(["  abcd…"]);
  });
});

import { formatHelp, parseCommandArgs } from "@/lib/cli";

describe("command definitions", () => {
  const options = {
    from: { type: "string", placeholder: "dd/mm/yyyy", description: "first day" },
    tz: { type: "string", description: "timezone", default: "Asia/Bangkok" },
    dry: { type: "boolean", short: "d", description: "do nothing" },
  } as const;

  test("parses flags, defaults and built-ins", () => {
    expect(parseCommandArgs(options, ["--from", "18/10/2026", "-d"])).toEqual({
      from: "18/10/2026",
      tz: "Asia/Bangkok",
      dry: true,
      verbose: false,
      help: false,
    });
    expect(parseCommandArgs(options, ["-h"]).help).toBe(true);
  });

  test("unknown flags and stray arguments are usage errors", () => {
    expect(() => parseCommandArgs(options, ["--nope"])).toThrow(UsageError);
    expect(() => parseCommandArgs(options, ["stray"])).toThrow(UsageError);
  });

  test("help lists every option with placeholders and defaults", () => {
    const help = formatHelp({ name: "demo", description: "Does a thing.", options });
    expect(help).toContain("bun run demo [options]");
    expect(help).toMatch(/--from <dd\/mm\/yyyy>\s+first day/);
    expect(help).toMatch(/--tz <value>\s+timezone \(default Asia\/Bangkok\)/);
    expect(help).toMatch(/-d, --\[no-\]dry\s+do nothing/);
    expect(help).toMatch(/-h, --help\s+show this help/);
    expect(help).toMatch(/--verbose\s+show debug logging/);
  });
});

import { resolveFlag } from "@/lib/cli";

describe("yes/no flags", () => {
  const options = { pnl: { type: "boolean", description: "sum profit/loss" } } as const;

  test("--x, --no-x and omitted", () => {
    expect(parseCommandArgs(options, ["--pnl"]).pnl).toBe(true);
    expect(parseCommandArgs(options, ["--no-pnl"]).pnl).toBe(false);
    expect(parseCommandArgs(options, []).pnl).toBeUndefined();
  });

  test("help shows the negatable form", () => {
    expect(formatHelp({ name: "demo", description: "d", options })).toMatch(/--\[no-\]pnl\s+sum profit\/loss/);
  });

  test("resolveFlag uses the flag, else the fallback without a terminal", async () => {
    expect(await resolveFlag({ flag: "--pnl", value: true, ask: async () => false })).toBe(true);
    if (!process.stdin.isTTY) expect(await resolveFlag({ flag: "--pnl", value: undefined, ask: async () => true, fallback: false })).toBe(false);
  });
});
