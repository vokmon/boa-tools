# follow-up-logins

People with a Wix account who tried to sign in to the app during a period but had no valid
subscription, and still have none. A list to follow up: anyone who has subscribed since is left
out.

```
bun run follow-up-logins                                   # asks for dates and projects
bun run follow-up-logins --from 01/10/2026 --to 27/10/2026 --project all --pnl
```

The period defaults to the last 30 days, which is all Sentry keeps. In the terminal:

```
Sign-in attempts without a valid subscription, 28/09/2026 to 27/10/2026 (Asia/Bangkok)
21 people failed to sign in; 6 subscribed since and are left out.

TO FOLLOW UP (15)  latest attempt first
  Somchai   Jaidee   a@x.com   081-000-0000   3 attempts   last 26/10/2026 14:02   Trial (trial), ENDED 20/10/2026
  ...
```

The CSV in `<DATA_DIR>/reports/` has the same rows and order:
`first_name, last_name, email, phone, iq_option_id, attempts, attempt_days, last_attempt, last_plan, plan_type, plan_status, plan_end`.

With `--pnl` (or answering yes), each person also gets the profit/loss of their closed trades in
the period, the same as subscriber-usage: real and demo apart, split by system (bot), manual (in
the app) and outside (placed directly in IQ Option), e.g.
`12 trades   real -350.00 THB (system -300.00, manual -50.00), demo +20.00 USD (system +20.00)`.
The CSV gets `trades`, `pnl_real (THB)`, `pnl_real_system (THB)`, `pnl_real_manual (THB)`,
`pnl_real_outside (THB)` and the same four for demo. People without a valid IQ Option id in Wix
show "no IQ Option id" and blank columns. The trades are searched per person by IQ Option id, so
this takes a few seconds rather than reading every trade log in the period.

How it works:
1. Sentry: every "⛔ Subscription validation failed for: <email>" log in the period, grouped by
   email. iq-robot writes it when someone signs in with IQ Option, their IQ Option id is on a Wix
   contact, but that member has no ACTIVE order (or is not approved). Sentry masks the email in the
   message and keeps it in `message.parameter.0`.
2. Wix: the contacts with that email (name, phone) and all their pricing-plan orders.
3. Left out: anyone with a valid subscription now, on any contact with that email: an ACTIVE
   order that has not ended, or a PENDING one (paid, starts later). DRAFT orders are unpaid, so
   those people stay on the list.

Notes:
- The last plan is the one that matters now: upcoming (unpaid draft), else paused, else the one
  that ended most recently. Blank when the person never had a plan.
- An email with no Wix contact any more (e.g. deleted) is still listed, as `NOT_IN_WIX`.
- People whose IQ Option id is not on any Wix contact never reach this check, so they are not
  in this list (iq-robot logs them as "No Wix contact found for custom.iq-option=<id>").
