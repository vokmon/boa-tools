# Reading the results

## How a round is played

A signal at a candle's close opens a round. The first order goes on the next candle; it wins if that
candle closes in the signal's direction. After a loss, the next martingale level goes on the next
candle in the same direction with a bigger stake, up to the last level. A draw (close = open) repeats
the same order. A market gap stops the round. An asset takes no new signal on a candle it already
traded on. Orders are simulated as buying at the candle's open and settling at its close.

## What the numbers mean

- **Round**: One signal and its orders: the first order on the next candle, then one martingale level after each loss, until an order wins or the last level loses.
- **Session**: How we trade: a session starts at a Bangkok hour and ends at whichever comes first, its time, its take-profit or its stop-loss. Rounds already running when it ends still finish and count. Every start hour of every day is played, each with a fresh total.
- **Average session**: The money a session ends with, on average. It decides whether trading this way makes money; the share of sessions in profit does not (many small wins can hide a few big losses).
- **Sessions won**: The share of sessions that ended above 0 THB, however they ended: by reaching take-profit, or still above 0 when the time was up. With a small take-profit and a big stop-loss most sessions win even when the average loses.
- **How sessions end**: How often a session reached its take-profit, hit its stop-loss or ran out of time, each split into sessions that ended in profit and with a loss, with the average money and minutes. A session can end in profit without reaching take-profit (time was up), or below 0 after reaching it: rounds still running on other assets finish too.
- **After 20 sessions**: 20 sessions picked at random from the test, added up, 2,000 times: the middle 80% of those totals. What a stretch of 20 sessions most likely ends with, luck included.
- **Worst session**: The biggest loss of one session. It can go past the stop-loss: rounds already running when the stop is hit still finish, and with many assets trading at once they add up. Keep at least this before starting a session.
- **Start hours**: Sessions grouped by the Bangkok hour they started, best average first; the top 3 are highlighted when they made money. Hours without any session to trade are left out (N/A).
- **Rounds per day**: How many rounds started per day, all assets together. Stricter settings give fewer rounds. How busy the app is, is judged on signals an hour (see below).
- **Main / OTC / Total**: Every number for all assets together, for main assets and for OTC on their own, on weekdays and at the weekend (Saturday and Sunday, Bangkok time), so an edge on one group is not hidden by the other. Main assets almost stop at the weekend (only crypto trades); OTC is open all the time.
- **Signals per hour**: How often the signal fires per hour, all assets of the group together: how busy the setting is. A signal becomes a round unless the asset is still in a round or the most rounds open at once is reached. The goal is 25-42 an hour on a weekday.
- **Rounds per hour**: Rounds per hour the setting trades (all day, or only its hours). Fewer than the signals when the asset is still in a round or the most rounds open at once is reached.
- **Quiet stretch**: How long the app waits for a new round: 9 in 10 waits between new rounds (on any asset) are this long or shorter. A break outside the setting's hours does not count.
- **Rounds won**: How often a round ends in a win at any order: the first order or a martingale order. Martingale pushes it up (about 97% with 4 levels) at the cost of bigger stakes, so it shows how often a round recovers, not whether the rounds make money.
- **First-order win**: How often the first order wins: the one number that decides profit. At a payout of 85% it must be above 54.05% to make money; martingale does not change that, it only moves the losses into rare lost rounds.
- **First order, Martingale 1 … 4**: Which order won the round: the first order (no martingale), or martingale 1, 2, 3 or 4 after that many losses in a row. Later martingale orders use bigger stakes, so they earn more when they win but cost more to reach.
- **Lost all**: Rounds where every order lost. Each one costs the whole stack of stakes (1,933 THB with a 30 THB first order, 2.5x, 4 levels), so a few of them can wipe out many wins.
- **Profit**: Money won minus money lost over all rounds of all assets, in THB, with the order size and payout in the settings.
- **Profit per day**: Profit divided by the number of days tested.
- **Worst day**: The day with the biggest loss.
- **Biggest drop**: The deepest fall of the running total from a high point. Roughly the balance you need so a bad stretch does not end the session.
- **Most at once**: The most rounds running at the same moment across all assets: how much money can be tied up at once.
- **Full loss every**: How often a round loses every order, e.g. 1 per 4 days.
- **Worst round**: The money lost when every order of one round loses.
- **When to trade**: Rounds grouped by the Bangkok hour they started. Green hours earned at least the average per round, teal ones earned less, red ones lost money; grey hours had fewer than 100 rounds, too few to judge.
- **Martingale levels**: The same signal played with no martingale, or with at most 1, 2, 3 or 4 martingale orders after the first. The switch at the top shows the whole report at one of these; the best level is the one with the most profit per day. Fewer levels lose a round more often, but each lost round costs far less.
- **Last 2 weeks**: The newest 14 days on their own: the first-order win there. ✅ still above break-even; ❌ not, so a good result on the older days may have been luck. Keep the newest 2 weeks for checking a setting rather than choosing it.
- **Does it hold over time?**: The test cut into 4 equal stretches of days, oldest first, each with its rounds a day, where rounds were won (first order, martingale 1 … 4, lost all) and how sessions did. An edge worth trading shows in every stretch; one good stretch can be luck.
- **Running martingale chains**: When a session ends, rounds on other assets may still be in the middle of their martingale. Let them finish: every round plays out. Stop them: no more orders once the session ends, only orders already placed count. The report plays every session both ways and marks the better one.

## Reversal evidence (`--evidence`)

Every candle with a colour is a possible reversal bet: a PUT after a green candle, a CALL after a red
one. `--evidence` measures how often the next candle really reverses, grouped by each piece of
evidence on its own: the bot's signal, same colour in a row, stochastic, position in the box,
Bollinger band, Donchian breakout, body share, wick against the move, size vs the average body,
the asset's recent reversals, hour, and each asset. Every table shows candles per day, the
reversal rate for all assets, OTC and main, and for the older days and the newest 2 weeks. **Lasts**
✅ marks a group above break-even (54.05%) on both. The bot's signal row is a check: it matches the
backtest's first-order win. Writes `evidence.md` and `evidence.json`; takes ~10 s.

The explanations of the numbers and the settings ([settings.md](settings.md)) are the same text as in
`src/tools/backtest/report/guide.ts`, which the HTML report uses; a test keeps them identical.
