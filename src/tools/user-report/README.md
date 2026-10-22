# user-report

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
