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
| **600-1000 rounds a day**, all assets together (about 25-42 an hour) | the app should look busy (a new round every couple of minutes) without ordering nonstop; fewer looks idle, more is constant ordering |
| **Max martingale 4 or less** | more levels risk too much on one round |
| **Tested at martingale x2.5 and x2.2** | every candidate lists `"multiplier": [2.5, 2.2]`, so both show side by side (see below) |
| **Still profitable on the newest 2 weeks** | the newest 14 days are for checking a setting, not choosing it, so a lucky fit shows up |
| **A compromise, not a perfect record** | losing rounds are fine when the day still ends in profit |

If nothing reaches 54.1% at 600+ rounds a day, keep the best setting at fewer rounds too, so the
trade-off can be decided with real numbers.

The periods of Donchian (20), Bollinger (14) and support/resistance (25) stay as the bot uses them;
we tune the zone, stochastic level, candle rules and volume. Candles are always 1 minute.

## Why 97% won rounds still lose money

"Round win" counts rounds won at *any* martingale level. With 10 THB orders, x2.5 and 85% payout:

| Round ends | Money for the round |
|---|---|
| Win on the first order | +8.50 |
| Win at martingale 1 / 2 / 3 / 4 | +11.25 / +18.13 / +35.31 / +78.28 |
| All 5 orders lost | **-644** |

One lost round cancels about 46 won rounds (+14 on average), so break-even needs fewer than 1 round in
47 (2.1%) lost. A coin-flip first order loses all 5 orders 0.5^5 = 3.1% of the time: that is the 97%,
and it loses about 550 THB per 100 rounds. Each order loses 7.5% of its stake on average at 50% (win
+0.85, lose -1); martingale does not change the odds, it only stakes more per round (about 80 THB
instead of 10), so it loses more. **Only a better first order fixes it**; above 54.1% martingale
multiplies a profit instead.

## Martingale x2.5 or x2.2

The **multiplier** cannot make a losing signal win; it only sets how fast the money goes. With the
bot's signal, x2.5 / x2.2 / x2.0 lose 4,435 / 3,324 / 2,737 THB a day, with more losing days at the
lower ones. Below about x2.18 a late win no longer covers the orders lost before it (at x2.0 a win at
martingale 3 or 4 loses money).

With a real edge the two choices trade profit against risk, so every candidate is tested at both:

| | x2.5 | x2.2 |
|---|---|---|
| Win at martingale 4 | +78.28 | +12.24 |
| All 5 orders lost | -644 | -421 |
| In short | earns more on late wins | risks less, but late wins barely pay (just above x2.18) |

## Sessions and stopping

We trade in sessions (about an hour, then a break), not 24 hours a day. Stopping does not change what
a round earns on average, so:
- **Stop rules on your own money** (take profit, stop loss, after a losing streak) change how sessions
  feel (more small wins, fewer wrecked balances), never whether the signal makes money. Compare a few
  values you would really use; never search for the best one, it only finds luck.
- **Pausing because the signal is not working right now** (recent first-order win rate of an asset or
  of all assets is low) is a filter on the signal, and could really help if markets have streaks.
  It must pass the newest-2-weeks check like any other rule.
