# subscriber-usage

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
for the period, split by where each position was placed from, e.g.
`124 trades   real +1,234.50 THB (system +900.00, manual +400.00, outside -65.50), demo -20.00 USD (system -20.00)`:
- system: the bot placed it ("Order placed successfully (system)")
- manual: placed by hand in the app ("Order placed successfully (manual)")
- outside: the app has no order log for it, i.e. it was placed directly in IQ Option while the
  app was open

The total is all three added up. The CSV gets `pnl_real (THB)`, `pnl_real_system (THB)`,
`pnl_real_manual (THB)`, `pnl_real_outside (THB)` and the same four for demo. The header names
the most common currency; an amount in another currency is written with it, e.g. `12.50 USD`,
so currencies are never mixed. Amounts come from the "Position closed (<pnl>) - order (<ids>) - user_iq: <id>"
logs, de-duplicated by order ids (the same close is logged once per open browser tab), and are
matched by order id to the "Order placed" logs, which are searched from an hour before the
period so a position opened just before it still finds its order. This reads every
closed-position and placed-order log in the period (together about 2,000 a day, roughly 20
seconds per day), and only covers trades that closed while the app was open.
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
