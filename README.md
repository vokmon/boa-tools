# boa-tools

Utility scripts for BOA, run with [Bun](https://bun.sh).

```
bun install
cp .env.example .env   # fill in the keys
bun test
```

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

## Layout

```
src/
  config/     env validation (env.ts) and fixed business constants (constants.ts)
  lib/        tool-agnostic helpers: cli (commands, help, prompts), retrying fetch, logger, dates, CSV, tables
  clients/    thin services over the official SDKs (@wix/sdk, @sentry/api, IQ Option, Turso); no business logic
  storage/    candle data shared by tools (CandleDb: tables and queries in Turso)
  domain/     BOA knowledge shared by tools: app log formats, trades and profit/loss, subscriptions
  tools/      one folder per tool; the only place that combines clients
  tools/shared/  options several tools ask for: date range, Sentry projects
tests/        bun test, using fake fetch / fake services
docs/         plans and findings
```

Everything tools write locally goes under `DATA_DIR` (optional in `.env`, default `data/`, which git
ignores): CSV reports.

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

Every command gets `--help` (generated from `options`) and `--verbose`. `resolveOption` uses the
flag when given and otherwise prompts; without a terminal a missing flag is an error instead of a
hanging prompt. `chooseOne` / `chooseMany` are arrow-key pickers.

## subscriber-usage

Every Wix subscriber in a period and the days they used the app, so you can switch off trials
nobody uses and follow up with the most active users.

```
bun run subscriber-usage                 # asks for dates, plan type, match and Sentry projects
bun run subscriber-usage --from 18/10/2026 --to 20/10/2026 --plan trial --match started --project all --pnl
bun run subscriber-usage --help
```

Terminal output, grouped:

```
NEVER USED (8)  candidates to switch off
  first  last  iq_option_id  email  phone  ends dd/mm/yyyy
CANNOT CHECK (4)  fix in Wix before deciding
  first  last  iq_option_id  email  phone  reason
USED (45)  most active first
  first  last  iq_option_id  email  phone  2/3 days  18/10, 20/10
```

Never used is sorted by the subscription that ends soonest; used by days used, then log count.
Only days covered by a matching subscription count: with `--plan trial`, logs from days on a
paid plan are ignored.

With `--pnl` (or answering yes), the used section also shows closed trades and net profit/loss
for the period, e.g. `124 trades   real +1,234.50 THB, demo -20.00 USD`, and the CSV gets
`pnl_real (THB)` and `pnl_demo (USD)` columns. The header names the most common currency; an
amount in another currency is written with it, e.g. `12.50 USD`, so currencies are never mixed. Amounts come from the "Position closed (<pnl>) - order (<ids>) - user_iq: <id>"
logs, de-duplicated by order ids. This reads every closed-position log in the period (about
1,300 a day, roughly 10 seconds per day), and only covers trades that closed while the app was
open.
The CSV in `<DATA_DIR>/reports/` has the same rows and order:
`status, first_name, last_name, iq_option_id, email, phone, days_used, days_subscribed, used_days, plan, subscription_end`.

How it works:
1. Wix: load all pricing-plan orders and keep those matching the period and the plan type
   (price 0 = trial, otherwise paid). `--match active` keeps subscriptions that cover any part of
   the period; `--match started` keeps only those whose start date is inside the period.
2. Wix: load the buyers' contacts for name, email, phone and IQ Option id. One row per contact.
3. Sentry: for each valid id, an hourly timeseries of production logs matching `message:*<id>*`
   across the period, summed into local days.

Notes:
- Days used is the activity measure because logs are only written for trading events (mostly
  losses and martingale steps), so log count tracks losing streaks more than engagement.
- Sentry keeps logs for about 30 days, so older periods will show everyone as never used.
- Someone who opened the app without trading can show as never used.
- Hourly buckets assume a timezone with a whole-hour offset, which Asia/Bangkok is.

## user-report

Subscription and trading performance for specific people, looked up by email.

```
bun run user-report                                   # asks for emails, dates and projects
bun run user-report --emails a@x.com,b@y.com --project all
bun run user-report --file emails.txt --from 01/10/2026 --to 21/10/2026 --project bot-boa
```

`--file` takes any text or CSV and uses every email address in it. The period defaults to the
last 30 days, which is all Sentry keeps. One block per person in the terminal:

```
a@x.com   Somchai Jaidee   IQ 100000001   081-000-0000
  Subscription    Trial (trial), ACTIVE, ends 25/10/2026 (5 days left), 1 other plan
  Activity        active 12 of 30 days, last seen 21/10/2026 13:17
  Real (THB)      240 orders (200 bot, 40 manual), stake 24,000.00, 236 closed, win rate 51%, P/L +1,250.00, balance 6,100.00
  Demo (USD)      30 orders (30 bot, 0 manual), stake 3,000.00, 30 closed, win rate 47%, P/L -150.00, balance 9,850.00
  Blocked         2 attempts without a valid subscription, last 18/10/2026
```

The CSV in `<DATA_DIR>/reports/` has one row per email with the same data in columns
(`real_orders`, `real_pnl`, `demo_balance`, ...).

Where each part comes from:
- Wix: the contact by primary email (name, phone, IQ Option id) and all their pricing-plan
  orders. The current subscription is the active one, else upcoming, else paused, else the most
  recently ended. Emails with no contact or several contacts are flagged.
- IQ Option id: the Wix field; if it is empty or not a number, the id on the person's
  "Order placed successfully" logs, matched by their IQ Option login email.
- Orders: "Order placed successfully (system|manual) ..." logs, de-duplicated by order id.
- Closed trades, win rate, P/L and balance: "Position closed (<pnl>) ..." logs.
- Active days and last seen: any log with the IQ Option id, plus the app-open log
  ("Received config for user <email>", written by iq-signal).
- Blocked: "Subscription validation failed" logs for the email.

Orders and closed trades can differ: positions still open at the end of the period are not
closed yet, positions opened before it can close inside it, and a close is only logged while the
app is open. Real and demo, and different currencies, are never added together.

## collect-candles

Downloads 1-minute candles for every IQ Option digital-options asset (OTC and main) into the Turso
database, one UTC day at a time, for the backtest (`docs/backtest-plan.md`). Nothing is kept on this
machine.

```
bun run collect-candles                                  # every day the broker still has, up to now
bun run collect-candles --from 01/10/2026 --to 20/10/2026
bun run collect-candles --from 20/10/2026 --to 20/10/2026 --force   # fetch again, overwrite
```

Needs in `.env`:

```
IQ_OPTION_USER / IQ_OPTION_PASSWORD   IQ Option login (an account without two-factor login)
TURSO_DATABASE_URL                    libsql://<database>-<user>.<region>.turso.io
TURSO_AUTH_TOKEN                      read & write token for that database (no expiry, or the weekly run breaks)
```

- The broker keeps only about **60 days** of 1-minute candles. Run this at least every few weeks
  (weekly is the plan) or older days are lost.
- Days are UTC (07:00 to 06:59 Bangkok time). An asset-day that is over and fully inside the
  broker's history is marked complete and skipped on later runs; today and the oldest edge day are
  stored as partial and fetched again. A failed asset-day is retried next run.
- Candles already stored are kept when a partial day is fetched again (the broker only returns
  closed candles), so only new rows count as Turso writes. `--force` overwrites.
- Assets: everything tradable at some hour in the next 7 days, plus every asset seen before.
- One day for all ~136 assets is ~170k rows (~11 MB).

### Daily run on Supabase

`supabase/functions/collect-candles/index.ts` is the same collector as a Supabase Edge Function
(Deno, self-contained, same tables and rules). Each call does one UTC day (default yesterday) for a
share of the assets, because Edge Functions stop a request at 2 s of CPU time and a full day for all
assets needs ~3.4 s:

```
POST /functions/v1/collect-candles  {"part": 0, "parts": 4}                       # yesterday; call part 0..3
POST /functions/v1/collect-candles  {"day": "2026-10-21", "part": 0, "parts": 4}  # a given day
```

Each part takes ~20 s and ~0.6-0.9 s CPU.

Secrets: `IQ_OPTION_USER`, `IQ_OPTION_PASSWORD`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`. The
response lists `fetched`, `skipped`, `failed` and `cpuMs`; failed assets are retried by the next call
for that day (or by `bun run collect-candles`). Test locally with
`deno run --allow-net --allow-env --allow-read --allow-sys --env-file=.env supabase/functions/collect-candles/index.ts`.

Tables: `candles` (every field the broker returns; `at` is nanoseconds, stored as REAL), `assets`,
`collected_days`. Browse and query them in the Turso dashboard (app.turso.tech, the database's data
browser / SQL shell).

Turso free plan (Oct 2026): 5 GB storage (~15 months of candles), 10M rows written and 500M rows read
per month. Re-collecting all ~60 days is ~8.75M writes, most of a month. Reads count rows scanned, so
heavy analysis (the backtest) should run on a local copy rather than query Turso repeatedly.
