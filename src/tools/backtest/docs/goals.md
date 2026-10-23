# Goals: what we are looking for

The rules a setting is judged by. Change them here only; [findings.md](findings.md) records what we
learned, [plan.md](plan.md) what we test next.

**The signal is a reversal signal.** It fires when the price has gone too far one way and should turn
back on the next candle: stretched to the top or bottom of its recent range (stochastic), at a recent
high or low (support/resistance zone), breaking out of the Donchian channel and the Bollinger band,
after several solid candles of the same colour. A PUT bets the next candle goes down after a run up;
a CALL the opposite.

**A good setting:**

| Target | Why |
|---|---|
| **First order wins more than 54.1%** (at 85% payout) | the one number that decides profit: below it every order loses money on average, whatever the martingale |
| **600-1000 rounds a weekday**, all assets together (about 25-42 an hour) | the app should look busy (a new round every couple of minutes) without ordering nonstop; fewer looks idle, more is constant ordering. Judged on weekdays: main assets almost stop at the weekend. Per session: 25-42 rounds an hour |
| **Max martingale 4 or less** | more levels risk too much on one round |
| **Tested at martingale x2.5 and x2.2** | every candidate lists `"multiplier": [2.5, 2.2]`, so both show side by side (see below) |
| **Still profitable on the newest 2 weeks** | the newest 14 days are for checking a setting, not choosing it, so a lucky fit shows up |
| **A compromise, not a perfect record** | losing rounds and losing sessions are fine when sessions still make money on average |

If nothing reaches 54.1% at 600+ rounds a day, keep the best setting at fewer rounds too, so the
trade-off can be decided with real numbers.

Every first order is **30 THB**, the smallest IQ Option takes; money in the results is in THB.

The periods of Donchian (20), Bollinger (14) and support/resistance (25) stay as the bot uses them;
we tune the zone, stochastic level and candle rules (shape and size). Candles are always 1 minute.
Volume is not used: only main assets have it, and it made too little difference (see findings.md).

## Why 97% won rounds still lose money

"Round win" counts rounds won at *any* martingale level. With a 30 THB first order (IQ Option's
minimum), x2.5 and 85% payout:

| Round ends | Money for the round |
|---|---|
| Win on the first order | +25.50 |
| Win at martingale 1 / 2 / 3 / 4 | +33.75 / +54.38 / +105.94 / +234.84 |
| All 5 orders lost | **-1,933** |

One lost round cancels about 46 won rounds (+42 on average), so break-even needs fewer than 1 round in
47 (2.1%) lost. A coin-flip first order loses all 5 orders 0.5^5 = 3.1% of the time: that is the 97%,
and it loses about 1,650 THB per 100 rounds. Each order loses 7.5% of its stake on average at 50% (win
+0.85, lose -1); martingale does not change the odds, it only stakes more per round (about 240 THB
instead of 30), so it loses more. **Only a better first order fixes it**; above 54.1% martingale
multiplies a profit instead.

## Martingale x2.5 or x2.2

The **multiplier** cannot make a losing signal win; it only sets how fast the money goes. With the
bot's signal and 30 THB orders, x2.5 / x2.2 / x2.0 lose about 13,300 / 10,000 / 8,200 THB a day, with more losing days at the
lower ones. Below about x2.18 a late win no longer covers the orders lost before it (at x2.0 a win at
martingale 3 or 4 loses money).

With a real edge the two choices trade profit against risk, so every candidate is tested at both:

| | x2.5 | x2.2 |
|---|---|---|
| Win at martingale 4 | +234.84 | +36.71 |
| All 5 orders lost | -1,933 | -1,263 |
| In short | earns more on late wins | risks less, but late wins barely pay (just above x2.18) |

## How we trade: sessions

We trade in **sessions**, not all day. A session ends at whichever comes first:

| Rule | Values we compare | With the 30 THB first order |
|---|---|---|
| **Time** | 30 or 60 minutes | |
| **Take-profit**: the session is up this much | 10x or 30x the first order | +300 or +900 THB |
| **Stop-loss**: the session is down as much as this many fully lost rounds | 1 or 2 | -1,933 or -3,866 THB at x2.5; -1,263 or -2,526 at x2.2 |

The four rules compared: 30 min / +10x / 1 round, 30 min / +30x / 1 round, 60 min / +10x / 1 round,
60 min / +30x / 2 rounds. Every round plays out its martingale as set, win or lose: a round still
running at a stop is finished, so a session can end a little past its stop-loss. Writing the stop-loss
in lost rounds keeps it right for every multiplier and amount; results show it in THB.

While researching, a session is started at every hour (00:00 … 23:00) of every day, to find the hours
worth trading; fixed start times come once we know them.

- **The signal still decides.** Stop rules decide when to walk away, not what a round earns: with a
  first order below 54.1% every session loses on average, whatever the stops. The search for the
  signal does not change.
- **The session is the unit for judging a setting**: the share of sessions that hit take-profit,
  stop-loss or time, the average session, the worst session and the longest losing streak (and the
  balance needed to survive it). The rounds goal becomes rounds per hour of a session (25-42).
- **Watch the trap:** a small take-profit and a big stop-loss make most sessions win even with a
  losing signal; the few losing sessions cost more than all the wins. The average session decides,
  never the share of winning sessions. Compare a few stop values you would really use; never search
  for the best one, it only finds luck.
- **Pausing because the signal is not working right now** (a low recent first-order win rate) is a
  filter on the signal, not a stop rule, and must pass the newest-2-weeks check like any other rule.
