# Settings files

A settings file is JSON in the settings folder. `bot-current.json` writes out every value as the bot
uses it today; copy it and change what you want. Anything left out keeps the bot's value, except
`sessions`, which every file must list (see the end). A list tries each value (`"level": [80, 85, 90]`
gives three settings; several lists give every combination). `note` is free text shown in the picker
and the report.

Every indicator has `"use": true` or `false`, so any combination can be tried without changing the
code: e.g. `"donchian": { "use": false }`. A signal needs every indicator that is used; the candle rules
always apply (set them loose to weaken them: `sameColourInARow` 1, `minBody` 0, `maxWick` 1,
`minSizeVsAverage` 0).

## Support / resistance

A box made of the highest high and lowest low of recent candles. A PUT needs the candle near the top of the box, a CALL near the bottom.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `supportResistance.use` Use support / resistance | Whether this rule is used: true or false. Every rule that is used must pass. | - | true | true / false |
| `supportResistance.period` Box length (candles) | How many candles the support/resistance box covers. | Higher: a wider box, so being near its edge is rarer. | 25 | 2-90 (whole) |
| `supportResistance.zone` How close to the edge (0-1) | How far into the top or bottom half of the box the candle must reach; 1 is the very edge. | Higher: only candles right at the edge count, fewer signals. | 0.92 | 0-1 |

## Donchian channel

The highest high and lowest low of recent candles. A PUT needs the candle to break above the channel, a CALL below it.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `donchian.use` Use the Donchian channel | Whether this rule is used: true or false. Every rule that is used must pass. | - | true | true / false |
| `donchian.period` Channel length (candles) | How many candles the Donchian channel covers. | Higher: a breakout needs a longer-term high or low, fewer signals. | 20 | 2-90 (whole) |

## Bollinger bands

Bands around the average price, as wide as the recent price swings. A PUT needs the candle's high above the upper band, a CALL its low below the lower band.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `bollinger.use` Use Bollinger bands | Whether this rule is used: true or false. Every rule that is used must pass. | - | true | true / false |
| `bollinger.period` Band length (candles) | How many closes the Bollinger average and width use. | Higher: smoother, slower bands. | 14 | 2-90 (whole) |
| `bollinger.stdDev` Band width | How wide the bands are, in standard deviations of recent closes. | Higher: wider bands, so poking outside is rarer, fewer signals. | 2 | 0.5-5 |

## Stochastic

Where the close sits in its recent range, 0 to 100. A PUT needs both %K and %D very high (stretched up), a CALL both very low.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `stochastic.use` Use the stochastic | Whether this rule is used: true or false. Every rule that is used must pass. | - | true | true / false |
| `stochastic.useD` Check %D too | Whether a PUT also needs %D above the level (a CALL below), not only %K. iq-robot checks %K only since 27/10/2026. | Off: more signals. | true | true / false |
| `stochastic.k` %K length (candles) | How many candles the stochastic range covers. | Higher: a longer range, slower to reach the extremes. | 13 | 2-60 (whole) |
| `stochastic.d` %D length | How many %K values %D averages. | Higher: a smoother, slower %D. | 3 | 1-20 (whole) |
| `stochastic.smooth` %K smoothing | How many raw values %K averages. | Higher: a smoother, slower %K. | 3 | 1-20 (whole) |
| `stochastic.level` Extreme level | A PUT needs %K and %D above this, a CALL below 100 minus it. | Higher: only more stretched prices count, fewer signals. | 85 | 50-100 |

## Candle shape and size

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

## Martingale

What happens after a losing order: the next order goes in the same direction on the next candle with a bigger stake, up to the last level.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `martingale.type` Martingale type | standard: each level stakes the multiplier times the previous one. recovery: each level is sized to win back all losses plus a normal win. cover: each level is sized to win back exactly the losses, so a round won by martingale ends at 0 and only first-order wins earn. | - | standard | standard / recovery / cover |
| `martingale.multiplier` Stake multiplier | Standard martingale: each level stakes this times the previous one. | Higher: wins back losses faster, but a lost round costs far more. | 2.5 | 1-10 |
| `martingale.levels` Martingale levels | Orders after the first one; 4 means up to 5 orders per round. | Higher: more rounds end in a win, but a lost round costs far more. | 4 | 0-8 (whole) |

## Order

The stake of the first order and the payout of a win.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `order.amount` First order (THB) | The stake of the first order of each round. | Higher: everything scales up, profit and losses alike. | 30 | 30-1000000 |
| `order.payout` Payout (%) | Profit on a winning order, in percent of the stake. | Higher: lowers the win rate needed to break even. | 85 | 1-100 |

## Trading

How many rounds the bot may have open at the same time across all assets. Rounds take about 2 minutes; usually 2 are open, but signals can come in bursts of 40 at once.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `trading.maxOpenRounds` Most rounds open at once | A new round only starts while fewer than this many rounds are running on all assets together; otherwise the signal is skipped. 0 means no limit, as the bot trades today. | Higher: more rounds, and bigger bursts when many assets signal at once. | 0 | 0-1000 (whole) |

## Hours

Only start rounds in these Bangkok hours, e.g. ["07-11", "20-23"] (the end hour is excluded). All day when left out.

## Sessions

How we trade, required in every settings file (see [goals.md](goals.md)). Each rule is played on its
own: a session starts at every Bangkok hour of every day and ends at whichever comes first, its
time, its take-profit or its stop-loss.

```json
"sessions": [
  { "minutes": 30, "takeProfitMultiplier": 10, "stopLossRounds": 1 },
  { "minutes": 60, "takeProfitMultiplier": 30, "stopLossRounds": 2 }
]
```

| Setting | What it is | Allowed |
|---|---|---|
| `minutes` | How long a session lasts at most. | 1-1440 (whole) |
| `takeProfitMultiplier` | Stop once the session is up this many times the first order: 10 = 300 THB with a 30 THB order. Leave out for no take-profit. | 0.1-10000 |
| `stopLossRounds` | Stop once the session is down as much as this many fully lost rounds: 1 = 1,933 THB at x2.5, 1,263 at x2.2 (30 THB order). Leave out for no stop-loss. | 0.1-100 |
