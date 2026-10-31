# member-report

Every Wix site member: name, email, phone, last login, last completed online training and the
plan that matters now (active or not). Optionally, the profit/loss of their closed trades.

```
bun run member-report                                    # asks whether to include P/L
bun run member-report --no-pnl
bun run member-report --pnl --from all --project all     # every trade Sentry still keeps
bun run member-report --pnl --from 01/10/2026 --to 31/10/2026 --project all
```

In the terminal, active subscriptions first, then by latest login:

```
Wix members (Asia/Bangkok)
858 members: 120 with an active subscription, 738 without; 310 completed a training.

  Somchai   Jaidee   a@x.com   081-000-0000   login 30/10/2026 21:14   Bot basics 12/10/2026 (+1)   ACTIVE: Bot 1 Month (paid), ACTIVE 25/11/2026
  ...
```

The CSV in `<DATA_DIR>/reports/` (`member-report_<today>.csv`, or `member-report_<from>_<to>.csv`
with P/L, `member-report_all_<to>.csv` for all trades) has the same rows and order:
`first_name, last_name, email, phone, last_login, last_training_completed, training_completed_at,
trainings_completed, last_plan, plan_type, plan_status, plan_end, subscription_active, iq_option_id`.

With `--pnl` (or answering yes), each member also gets the profit/loss of their closed trades in
the period, the same as subscriber-usage: real and demo apart, split by system (bot), manual (in
the app) and outside (placed directly in IQ Option). The CSV gets `trades`, `pnl_real (THB)`,
`pnl_real_system (THB)`, ... and the same for demo. Members without a valid IQ Option id in Wix show
"no IQ Option id" and blank columns. Every trade log in the period is read once (as
subscriber-usage does), which is faster than a search per member when there are hundreds of them.
The dates only set the trade period; every Wix member is always listed. Leave From empty (or pass
`--from all`) for all trades: it searches from 90 days back, and Sentry returns whatever it still
keeps (about 30 days). Members with no trades in Sentry simply get zero.

Where the data comes from:
- Members: Wix Members (`loginEmail`, `lastLoginDate`, and the member's name and phone). Name,
  phone and the IQ Option id fall back to the Wix contact.
- Last login: the last login to the Wix site, not to the app.
- Training: Wix Online Programs, participations with status COMPLETED. Wix keeps no completion
  date, so `training_completed_at` is the participant's last activity (the last step done).
  `trainings_completed` counts the completed programs.
- Plan: the member's pricing-plan orders, the same as follow-up-logins: the active one, else
  upcoming, else paused, else the one that ended most recently. `subscription_active` is yes for an
  ACTIVE order that has not ended or a PENDING (paid) one.

Notes:
- Site collaborators (owner, admins) cannot be told apart through the Wix API, so anyone of them
  who is also a site member is listed too.
- The Wix API key needs the Online Programs read permission. Without it the report still runs,
  warns, and leaves the training columns blank.
