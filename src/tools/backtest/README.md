# backtest

Replays the bot on every collected 1-minute candle and shows, for each setting, how often rounds win,
at which martingale level, the profit per day, the risk, and the best hours to trade (Bangkok time).
Use it to compare settings files: your own ideas, or ones an AI suggests from the brief.

## What we are looking for

**The signal is a reversal signal.** It fires when the price has gone too far one way and should turn
back on the next candle: stretched to the top or bottom of its recent range (stochastic), at a recent
high or low (support/resistance zone), breaking out of the Donchian channel and the Bollinger band,
after several solid candles of the same colour. A PUT bets the next candle goes down after a run up;
a CALL the opposite.

**A good setting:**

| Target | Why |
|---|---|
| **800+ rounds a day**, all assets together | the bot should trade steadily, about as much as it does today (~830) |
| **First order wins more than 54.1%** (at 85% payout) | below that every order loses money on average, whatever the martingale |
| **Max martingale 4 or less** | more levels risk too much on one round |
| **Still profitable on the newest 2 weeks** | the newest 14 days are for checking a setting, not choosing it, so a lucky fit shows up |
| **A compromise, not a perfect record** | losing rounds are fine when the day still ends in profit |

The periods of Donchian (20), Bollinger (14) and support/resistance (25) stay as the bot uses them;
we tune the zone, stochastic level, candle rules and volume. Candles are always 1 minute.

**Findings so far (24/08-21/10/2026):**
- The bot's current settings: the first order wins **50.6%**, the same as a random candle; the
  martingale turns that into 97% won rounds but loses about 4,400 THB a day (10 THB orders).
- Of about 2,600 combinations of zone, stochastic level, candle rules and volume, the ones with
  800+ rounds a day all stay at **50.4-51%**: they change how often the bot trades, not how often
  it is right. OTC assets (most of the rounds) behave like a coin flip.
- A **volume spike** on the signal candle (2-3x the recent average) is the first real edge: 55-60%
  on main assets, holding up on the newest 2 weeks, but only 9-50 rounds a day (OTC has no volume).
- With a below-break-even first order, every martingale level loses more; no martingale loses least.

**How we test from here:** reason from the reversal idea instead of trying random numbers. First
measure, for every candle, how often the next candle really reverses after each piece of evidence on
its own (same-colour run, stochastic level, zone, band, candle size, volume), for OTC and main assets
separately; then combine only the evidence that works, and check it gives 800+ rounds a day.

## Running

```
bun run backtest                     # pick from a list: All, or each settings file
bun run backtest --all               # every settings file
bun run backtest --settings bot-current,my-idea
bun run backtest --all --html        # also write report.html and open it
```

Every run first brings Turso up to date from IQ Option (every day the broker still has, up to now)
and updates the local copy (`DATA_DIR`); the backtest then uses all complete days. Each setting is
played at max martingale 0 to 4. A few settings take ~30 s.

| .env | What | Default |
|---|---|---|
| `BACKTEST_SETTINGS_DIR` | settings files (*.json) | `backtest/settings` |
| `BACKTEST_RESULTS_DIR` | one folder per run | `<DATA_DIR>/backtest` |
| `DATA_DIR` | local candle copy | `data` |

## How a round is played

A signal at a candle's close opens a round. The first order goes on the next candle; it wins if that
candle closes in the signal's direction. After a loss, the next martingale level goes on the next
candle in the same direction with a bigger stake, up to the last level. A draw (close = open) repeats
the same order. A market gap stops the round. An asset takes no new signal on a candle it already
traded on. Orders are simulated as buying at the candle's open and settling at its close.

## Settings files

A settings file is JSON in the settings folder. `bot-current.json` writes out every value as the bot
uses it today; copy it and change what you want. Anything left out keeps the bot's value. A list tries
each value (`"level": [80, 85, 90]` gives three settings; several lists give every combination).
`note` is free text shown in the picker and the report.

### Support / resistance

A box made of the highest high and lowest low of recent candles. A PUT needs the candle near the top of the box, a CALL near the bottom.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `supportResistance.period` Box length (candles) | How many candles the support/resistance box covers. | Higher: a wider box, so being near its edge is rarer. | 25 | 2-90 (whole) |
| `supportResistance.zone` How close to the edge (0-1) | How far into the top or bottom half of the box the candle must reach; 1 is the very edge. | Higher: only candles right at the edge count, fewer signals. | 0.92 | 0-1 |

### Donchian channel

The highest high and lowest low of recent candles. A PUT needs the candle to break above the channel, a CALL below it.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `donchian.period` Channel length (candles) | How many candles the Donchian channel covers. | Higher: a breakout needs a longer-term high or low, fewer signals. | 20 | 2-90 (whole) |

### Bollinger bands

Bands around the average price, as wide as the recent price swings. A PUT needs the candle's high above the upper band, a CALL its low below the lower band.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `bollinger.period` Band length (candles) | How many closes the Bollinger average and width use. | Higher: smoother, slower bands. | 14 | 2-90 (whole) |
| `bollinger.stdDev` Band width | How wide the bands are, in standard deviations of recent closes. | Higher: wider bands, so poking outside is rarer, fewer signals. | 2 | 0.5-5 |

### Stochastic

Where the close sits in its recent range, 0 to 100. A PUT needs both %K and %D very high (stretched up), a CALL both very low.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `stochastic.k` %K length (candles) | How many candles the stochastic range covers. | Higher: a longer range, slower to reach the extremes. | 13 | 2-60 (whole) |
| `stochastic.d` %D length | How many %K values %D averages. | Higher: a smoother, slower %D. | 3 | 1-20 (whole) |
| `stochastic.smooth` %K smoothing | How many raw values %K averages. | Higher: a smoother, slower %K. | 3 | 1-20 (whole) |
| `stochastic.level` Extreme level | A PUT needs %K and %D above this, a CALL below 100 minus it. | Higher: only more stretched prices count, fewer signals. | 85 | 50-100 |

### Candle shape and size

The signal candle must be a solid move: a big body, a small wick against the move, several candles of the same colour in a row, and not small compared with recent candles.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `candle.sameColourInARow` Same colour in a row | How many candles of the same colour must come in a row, ending with the signal candle. | Higher: needs a longer run, fewer signals. | 3 | 1-20 (whole) |
| `candle.minBody` Minimum body (0-1) | The body must be at least this share of the candle's high-to-low range. | Higher: only solid candles, fewer signals. | 0.6 | 0-1 |
| `candle.maxWick` Maximum wick against the move (0-1) | The wick against the move (upper for PUT, lower for CALL) must be under this share of the range. | Higher: allows bigger wicks, more signals. | 0.25 | 0-1 |
| `candle.checkLast` Candles checked for body and wick | How many latest candles must pass the body rule; the signal candle's wick must also be the smallest of them. | Higher: stricter, fewer signals. | 1 | 1-10 (whole) |
| `candle.minSizeVsAverage` Minimum size vs recent average | The latest candles' bodies must each be at least this many times the average body of the candles before them. | Higher: needs bigger candles than usual, fewer signals. | 0.75 | 0-5 |
| `candle.sizeCandles` Candles checked for size | How many latest candles the size rule applies to. | Higher: stricter, fewer signals. | 3 | 1-10 (whole) |
| `candle.sizeLookback` Candles in the average size | How many earlier candles the average body is taken over. | Higher: a longer-term average. | 35 | 5-90 (whole) |

### Volume

The signal candle's volume (how much was traded in that minute) against the average of the candles just before it. Not part of the bot's signal today; off unless set. IQ Option reports no volume for OTC assets.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `volume.minVsAverage` Busy signal candle (x average) | The signal candle's volume must be at least this many times the average volume before it, e.g. 2 means double. 0 turns it off. | Higher: only candles with a bigger burst of trading, fewer signals. | 0 | 0-20 |
| `volume.maxVsAverage` Quiet signal candle (x average) | The signal candle's volume must be at most this many times the average volume before it, e.g. 0.8. 0 turns it off. | Higher: allows busier candles, more signals. | 0 | 0-20 |
| `volume.lookback` Candles in the average volume | How many candles before the signal candle the average volume is taken over. | Higher: a longer-term average. | 20 | 1-99 (whole) |
| `volume.withoutVolume` Assets without volume | What to do where there is no volume to check (OTC assets): trade ignores the volume rule there, skip does not trade those assets, so only assets with volume trade. | - | trade | trade / skip |

### Martingale

What happens after a losing order: the next order goes in the same direction on the next candle with a bigger stake, up to the last level.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `martingale.type` Martingale type | standard: each level stakes the multiplier times the previous one. recovery: each level is sized to win back all losses plus a normal win. | - | standard | standard / recovery |
| `martingale.multiplier` Stake multiplier | Standard martingale: each level stakes this times the previous one. | Higher: wins back losses faster, but a lost round costs far more. | 2.5 | 1-10 |
| `martingale.levels` Martingale levels | Orders after the first one; 4 means up to 5 orders per round. | Higher: more rounds end in a win, but a lost round costs far more. | 4 | 0-8 (whole) |

### Order

The stake of the first order and the payout of a win.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `order.amount` First order (THB) | The stake of the first order of each round. | Higher: everything scales up, profit and losses alike. | 10 | 1-1000000 |
| `order.payout` Payout (%) | Profit on a winning order, in percent of the stake. | Higher: lowers the win rate needed to break even. | 85 | 1-100 |

### Hours

Only start rounds in these Bangkok hours, e.g. ["07-11", "20-23"] (the end hour is excluded). All day when left out.

## What the numbers mean

- **Round**: One signal and its orders: the first order on the next candle, then one martingale level after each loss, until an order wins or the last level loses.
- **Rounds per day**: How many rounds started per day, all assets together. Stricter settings give fewer rounds.
- **Round win**: Rounds that ended with a win at any level. It is high even for a bad setting, because martingale keeps trying.
- **First order, Martingale 1 … 4**: Which order won the round: the first order (no martingale), or martingale 1, 2, 3 or 4 after that many losses in a row. Later martingale orders use bigger stakes, so they earn more when they win but cost more to reach.
- **First-order win**: How often the first order wins. At a payout of 85% it must be above 54.05% to make money; martingale does not change that, it only moves the losses into rare lost rounds.
- **Lost all**: Rounds where every order lost. Each one costs the whole stack of stakes (644 THB with 10 THB orders, 2.5x, 4 levels), so a few of them can wipe out many wins.
- **Profit**: Money won minus money lost over all rounds of all assets, in THB, with the order size and payout in the settings.
- **Profit per day**: Profit divided by the number of days tested.
- **Losing days**: Days (Bangkok time) that ended with a loss, out of all days tested.
- **Worst day**: The day with the biggest loss.
- **Biggest drop**: The deepest fall of the running total from a high point. Roughly the balance you need so a bad stretch does not end the session.
- **Most at once**: The most rounds running at the same moment across all assets: how much money can be tied up at once.
- **Full loss every**: How often a round loses every order, e.g. 1 per 4 days.
- **Worst round**: The money lost when every order of one round loses.
- **When to trade**: Rounds grouped by the Bangkok hour they started. Green hours earned at least the average per round, teal ones earned less, red ones lost money; grey hours had fewer than 100 rounds, too few to judge.
- **Martingale levels**: The same signal played with no martingale, or with at most 1, 2, 3 or 4 martingale orders after the first. The switch at the top shows the whole report at one of these; the best level is the one with the most profit per day. Fewer levels lose a round more often, but each lost round costs far less.
- **Last 2 weeks**: The newest 14 days on their own, compared with the days before them. ✅ still made money there; ⚠️ did much worse, so a good result on the older days may have been luck. Keep the newest 2 weeks for checking a setting rather than choosing it.

## Output (BACKTEST_RESULTS_DIR/<date_time>/)

| File | For |
|---|---|
| `report.html` | with `--html`: one page with the comparison, a tab per setting, what matters and these explanations |
| `results.csv` | one row per setting, for Excel or Sheets |
| `results.json` | everything, for programs: per setting its values, summary (incl. per-hour and per-day) and per-asset results |
| `ai-brief.md` | paste into an AI to get the next settings files to try (see below) |
| `settings/` | every setting of the run as a settings file |

## Asking an AI for the next settings

1. Run a backtest.
2. Paste `ai-brief.md` into an AI. It has the goal, the round rules, the break-even, every setting
   tried with its results, what mattered, the settings format with ranges, and the request.
3. Save the files it suggests in the settings folder; they appear in the picker.
4. Run them, and repeat.

The explanations above are the same text as in `src/tools/backtest/report/guide.ts`, which the HTML
report uses; a test keeps them identical.
