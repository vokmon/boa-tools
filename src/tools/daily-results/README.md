# daily-results

Everyone who closed a trade on a day, with their name, email and phone from Wix and whether they
won or lost.

```
bun run daily-results                                  # today; asks for projects
bun run daily-results --date 01/11/2026 --project all
```

In the terminal, the biggest real loss first:

```
Trade results, 02/11/2026 (Asia/Bangkok)
12 people traded: 4 win, 7 loss, 1 demo only.
Real, all together: -1,250.00 THB.

  Somchai   Jaidee   a@x.com   081-000-0000   LOSS   18 trades   real -900.00 THB (system -600.00, manual -300.00)
  ...
```

The CSV in `<REPORTS_DIR>` (default `data/reports`), `daily-results_<date>.csv`, has the same rows:
`first_name, last_name, email, phone, iq_option_id, result, trades, wins, losses`, then
`pnl_real (THB)`, `pnl_real_system`, `pnl_real_manual`, `pnl_real_outside` and the same for demo.

How it works:
1. Sentry: the day's "Position closed" logs (and "Order placed", to tell system, manual and
   outside-the-app trades apart), the same reader as subscriber-usage. A position logged several
   times (several browsers open) is counted once, by order id.
2. Wix: the contacts with those IQ Option ids (`custom.iq-option`), for name, email and phone. An id
   on no contact is still listed, as "not in Wix" (`NOT_IN_WIX` in the CSV).
3. Result: WIN, LOSS or EVEN by the net of the real account only; DEMO ONLY when the person only
   traded on demo. Demo profit/loss is shown next to it.

The day is the local day in `--tz` (default Asia/Bangkok). Sentry keeps about 30 days.
