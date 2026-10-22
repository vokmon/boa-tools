# collect-candles

Downloads 1-minute candles for every IQ Option digital-options asset (OTC and main) into the Turso
database, one UTC day at a time, for the backtest. Nothing is kept on this
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
- One day for all ~166 assets is ~170k rows (~11 MB).

## Daily run on Supabase

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
