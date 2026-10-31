# boa-tools

Utility scripts for BOA, run with [Bun](https://bun.sh).

```
bun install
cp .env.example .env   # fill in the keys
bun test
```

## Tools

| Command | What it does | Details |
|---|---|---|
| `bun run subscriber-usage` | every Wix subscriber in a period and the days they used the app | [README](src/tools/subscriber-usage/README.md) |
| `bun run user-report` | subscription and trading performance for people, by email | [README](src/tools/user-report/README.md) |
| `bun run follow-up-logins` | people who tried to sign in without a valid subscription and still have none | [README](src/tools/follow-up-logins/README.md) |
| `bun run member-report` | every Wix member: last login, last training, plan, optional trade P/L | [README](src/tools/member-report/README.md) |
| `bun run collect-candles` | 1-minute candles of every IQ Option asset into Turso (also runs daily on Supabase) | [README](src/tools/collect-candles/README.md) |
| `bun run backtest` | replays the bot on the collected candles with settings files; report, AI brief | [README](src/tools/backtest/README.md) |

Every command has `--help`, which also lists the `.env` keys it needs. Files tools write go under
`DATA_DIR` (default `data/`, ignored by git).

## Tools and services

| What | Used for |
|---|---|
| [Bun](https://bun.sh) + TypeScript | runtime and test runner (`bun test`) |
| [zod](https://zod.dev) | `.env` validation |
| [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) | interactive prompts and pickers |
| [@wix/sdk](https://dev.wix.com/docs/sdk) (pricing-plans, crm) | subscribers and contacts |
| [@sentry/api](https://docs.sentry.io/api/) | app usage and trade logs |
| [@quadcode-tech/client-sdk-js](https://www.npmjs.com/package/@quadcode-tech/client-sdk-js) 1.3.26 | IQ Option login, assets and candles (same version as iq-robot) |
| [Turso](https://turso.tech) (hosted SQLite) + [@libsql/client](https://www.npmjs.com/package/@libsql/client) | candles database (free plan, no card) |
| [Supabase](https://supabase.com) Edge Function + pg_cron | daily candle collection |

## Layout

```
src/
  config/     env validation (env.ts) and fixed business constants (constants.ts)
  lib/        tool-agnostic helpers: cli (commands, help, prompts), progress output, retry, logger, dates, CSV, tables
  clients/    thin services over the official SDKs (Wix, Sentry, IQ Option, Turso); no business logic
  storage/    candle data: CandleDb (Turso) and LocalCandleCache (local copy for the backtest)
  domain/     BOA knowledge: app log formats, trades, subscriptions, the bot's signal, backtest rounds
  tools/      one folder per tool (with its README); the only place that combines clients
supabase/     the daily collect-candles Edge Function
backtest/     backtest settings files
tests/        bun test, with fakes; reference/iq-robot is a frozen copy of the bot's signal code
```

## Writing a new tool

Create `src/tools/<name>/index.ts`, add `"<name>": "bun src/tools/<name>/index.ts"` to
`package.json` scripts, and declare the command with `defineCommand` from `src/lib/cli`:

```ts
defineCommand({
  name: "my-tool",
  description: "What it does.",
  options: {
    from: { type: "string", placeholder: "dd/mm/yyyy", description: "first day" },
  },
  env: [{ name: "MY_KEY", description: "what it is for" }],
  run: async (values) => {
    const from = await resolveOption({
      flag: "--from",
      value: values.from,
      parse: parseDate,
      ask: () => askParsed("From (dd/mm/yyyy):", parseDate),
    });
  },
});
```

Every command gets `--help` (generated from `options` and `env`) and `--verbose`. `resolveOption`
uses the flag when given and otherwise prompts; without a terminal a missing flag is an error
instead of a hanging prompt. `chooseOne` / `chooseMany` are arrow-key pickers.
