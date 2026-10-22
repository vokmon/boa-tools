# Settings files

A settings file is JSON in the settings folder. `bot-current.json` writes out every value as the bot
uses it today; copy it and change what you want. Anything left out keeps the bot's value. A list tries
each value (`"level": [80, 85, 90]` gives three settings; several lists give every combination).
`note` is free text shown in the picker and the report.

## Support / resistance

A box made of the highest high and lowest low of recent candles. A PUT needs the candle near the top of the box, a CALL near the bottom.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `supportResistance.period` Box length (candles) | How many candles the support/resistance box covers. | Higher: a wider box, so being near its edge is rarer. | 25 | 2-90 (whole) |
| `supportResistance.zone` How close to the edge (0-1) | How far into the top or bottom half of the box the candle must reach; 1 is the very edge. | Higher: only candles right at the edge count, fewer signals. | 0.92 | 0-1 |

## Donchian channel

The highest high and lowest low of recent candles. A PUT needs the candle to break above the channel, a CALL below it.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `donchian.period` Channel length (candles) | How many candles the Donchian channel covers. | Higher: a breakout needs a longer-term high or low, fewer signals. | 20 | 2-90 (whole) |

## Bollinger bands

Bands around the average price, as wide as the recent price swings. A PUT needs the candle's high above the upper band, a CALL its low below the lower band.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `bollinger.period` Band length (candles) | How many closes the Bollinger average and width use. | Higher: smoother, slower bands. | 14 | 2-90 (whole) |
| `bollinger.stdDev` Band width | How wide the bands are, in standard deviations of recent closes. | Higher: wider bands, so poking outside is rarer, fewer signals. | 2 | 0.5-5 |

## Stochastic

Where the close sits in its recent range, 0 to 100. A PUT needs both %K and %D very high (stretched up), a CALL both very low.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
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

## Volume

The signal candle's volume (how much was traded in that minute) against the average of the candles just before it. Not part of the bot's signal today; off unless set. IQ Option reports no volume for OTC assets.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `volume.minVsAverage` Busy signal candle (x average) | The signal candle's volume must be at least this many times the average volume before it, e.g. 2 means double. 0 turns it off. | Higher: only candles with a bigger burst of trading, fewer signals. | 0 | 0-20 |
| `volume.maxVsAverage` Quiet signal candle (x average) | The signal candle's volume must be at most this many times the average volume before it, e.g. 0.8. 0 turns it off. | Higher: allows busier candles, more signals. | 0 | 0-20 |
| `volume.lookback` Candles in the average volume | How many candles before the signal candle the average volume is taken over. | Higher: a longer-term average. | 20 | 1-99 (whole) |
| `volume.withoutVolume` Assets without volume | What to do where there is no volume to check (OTC assets): trade ignores the volume rule there, skip does not trade those assets, so only assets with volume trade. | - | trade | trade / skip |

## Martingale

What happens after a losing order: the next order goes in the same direction on the next candle with a bigger stake, up to the last level.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `martingale.type` Martingale type | standard: each level stakes the multiplier times the previous one. recovery: each level is sized to win back all losses plus a normal win. | - | standard | standard / recovery |
| `martingale.multiplier` Stake multiplier | Standard martingale: each level stakes this times the previous one. | Higher: wins back losses faster, but a lost round costs far more. | 2.5 | 1-10 |
| `martingale.levels` Martingale levels | Orders after the first one; 4 means up to 5 orders per round. | Higher: more rounds end in a win, but a lost round costs far more. | 4 | 0-8 (whole) |

## Order

The stake of the first order and the payout of a win.

| Setting | What it is | Raising it | Bot | Allowed |
|---|---|---|---|---|
| `order.amount` First order (THB) | The stake of the first order of each round. | Higher: everything scales up, profit and losses alike. | 10 | 1-1000000 |
| `order.payout` Payout (%) | Profit on a winning order, in percent of the stake. | Higher: lowers the win rate needed to break even. | 85 | 1-100 |

## Hours

Only start rounds in these Bangkok hours, e.g. ["07-11", "20-23"] (the end hour is excluded). All day when left out.
