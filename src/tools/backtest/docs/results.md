# Reading the results

## How a round is played

A signal at a candle's close opens a round. The first order goes on the next candle; it wins if that
candle closes in the signal's direction. After a loss, the next martingale level goes on the next
candle in the same direction with a bigger stake, up to the last level. A draw (close = open) repeats
the same order. A market gap stops the round. An asset takes no new signal on a candle it already
traded on. Orders are simulated as buying at the candle's open and settling at its close.

## What the numbers mean

- **Round**: One signal and its orders: the first order on the next candle, then one martingale level after each loss, until an order wins or the last level loses.
- **Rounds per day**: How many rounds started per day, all assets together. Stricter settings give fewer rounds. The goal is 600-1000: fewer and the app looks idle, more and it orders almost every minute.
- **Rounds per hour**: Rounds per hour the setting trades (all day, or only its hours). 25-42 an hour is the goal of 600-1000 a day.
- **Quiet stretch**: How long the app waits for a new round: 9 in 10 waits between new rounds (on any asset) are this long or shorter. A break outside the setting's hours does not count.
- **First-order win**: How often the first order wins: the one number that decides profit. At a payout of 85% it must be above 54.05% to make money; martingale does not change that, it only moves the losses into rare lost rounds.
- **Won at any level**: Rounds that ended with a win at any martingale level. It is high even for a bad setting (about 97% for a coin flip with 4 levels), because martingale keeps trying; it says nothing about profit.
- **First order, Martingale 1 … 4**: Which order won the round: the first order (no martingale), or martingale 1, 2, 3 or 4 after that many losses in a row. Later martingale orders use bigger stakes, so they earn more when they win but cost more to reach.
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
- **Last 2 weeks**: The newest 14 days on their own, compared with the days before them: first-order win and profit per day. ✅ still made money there; ⚠️ did much worse, so a good result on the older days may have been luck. Keep the newest 2 weeks for checking a setting rather than choosing it.

## Reversal evidence (`--evidence`)

Every candle with a colour is a possible reversal bet: a PUT after a green candle, a CALL after a red
one. `--evidence` measures how often the next candle really reverses, grouped by each piece of
evidence on its own: the bot's signal, same colour in a row, stochastic, position in the box,
Bollinger band, Donchian breakout, body share, wick against the move, size vs the average body,
volume, the asset's recent reversals, hour, and each asset. Every table shows candles per day, the
reversal rate for all assets, OTC and main, and for the older days and the newest 2 weeks. **Lasts**
✅ marks a group above break-even (54.05%) on both. The bot's signal row is a check: it matches the
backtest's first-order win. Writes `evidence.md` and `evidence.json`; takes ~10 s.

The explanations of the numbers and the settings ([settings.md](settings.md)) are the same text as in
`src/tools/backtest/report/guide.ts`, which the HTML report uses; a test keeps them identical.
