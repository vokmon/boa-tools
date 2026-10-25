/**
 * Plain-language explanations of every number in the results and every setting. The HTML report
 * shows them as cards, src/tools/backtest/docs/results.md and settings.md repeat them word for word (a test checks), so
 * the report and the docs never disagree.
 */

export interface GuideEntry {
  /** Name as shown in the report and the docs. */
  name: string;
  text: string;
}

export const RESULT_GUIDE: readonly GuideEntry[] = [
  { name: "Round", text: "One signal and its orders: the first order on the next candle, then one martingale level after each loss, until an order wins or the last level loses." },
  { name: "Session", text: "How we trade: a session starts at a Bangkok hour and ends at whichever comes first, its time, its take-profit or its stop-loss. Rounds already running when it ends still finish and count. Every start hour of every day is played, each with a fresh total." },
  { name: "Average session", text: "The money a session ends with, on average. It decides whether trading this way makes money; the share of sessions in profit does not (many small wins can hide a few big losses)." },
  { name: "Sessions won", text: "The share of sessions that ended above 0 THB, however they ended: by reaching take-profit, or still above 0 when the time was up. With a small take-profit and a big stop-loss most sessions win even when the average loses." },
  { name: "How sessions end", text: "How often a session reached its take-profit, hit its stop-loss or ran out of time, each split into sessions that ended in profit and with a loss, with the average money and minutes. A session can end in profit without reaching take-profit (time was up), or below 0 after reaching it: rounds still running on other assets finish too." },
  { name: "After 20 sessions", text: "20 sessions picked at random from the test, added up, 2,000 times: the middle 80% of those totals. What a stretch of 20 sessions most likely ends with, luck included." },
  { name: "Worst session", text: "The biggest loss of one session. It can go past the stop-loss: rounds already running when the stop is hit still finish, and with many assets trading at once they add up. Keep at least this before starting a session." },
  { name: "Start hours", text: "Sessions grouped by the Bangkok hour they started, best average first; the top 3 are highlighted when they made money. Hours without any session to trade are left out (N/A)." },
  { name: "Rounds per day", text: "How many rounds started per day, all assets together. Stricter settings give fewer rounds. How busy the app is, is judged on signals an hour (see below)." },
  { name: "Main / OTC / Total", text: "Every number for all assets together, for main assets and for OTC on their own, on weekdays and at the weekend (Saturday and Sunday, Bangkok time), so an edge on one group is not hidden by the other. Main assets almost stop at the weekend (only crypto trades); OTC is open all the time." },
  { name: "Signals per hour", text: "How often the signal fires per hour, all assets of the group together: how busy the setting is. A signal becomes a round unless the asset is still in a round or the most rounds open at once is reached. The goal is 25-42 an hour on a weekday." },
  { name: "Rounds per hour", text: "Rounds per hour the setting trades (all day, or only its hours). Fewer than the signals when the asset is still in a round or the most rounds open at once is reached." },
  { name: "Quiet stretch", text: "How long the app waits for a new round: 9 in 10 waits between new rounds (on any asset) are this long or shorter. A break outside the setting's hours does not count." },
  { name: "First-order win", text: "How often the first order wins: the one number that decides profit. At a payout of 85% it must be above 54.05% to make money; martingale does not change that, it only moves the losses into rare lost rounds." },
  { name: "Rounds won", text: "How often a round ends in a win at any order: the first order or a martingale order. Martingale pushes it up (about 97% with 4 levels) at the cost of bigger stakes, so it shows how often a round recovers, not whether the rounds make money." },
  { name: "First order, Martingale 1 … 4", text: "Which order won the round: the first order (no martingale), or martingale 1, 2, 3 or 4 after that many losses in a row. Later martingale orders use bigger stakes, so they earn more when they win but cost more to reach." },
  { name: "Lost all", text: "Rounds where every order lost. Each one costs the whole stack of stakes (1,933 THB with a 30 THB first order, 2.5x, 4 levels), so a few of them can wipe out many wins." },
  { name: "Profit", text: "Money won minus money lost over all rounds of all assets, in THB, with the order size and payout in the settings." },
  { name: "Profit per day", text: "Profit divided by the number of days tested." },
  { name: "Worst day", text: "The day with the biggest loss." },
  { name: "Biggest drop", text: "The deepest fall of the running total from a high point. Roughly the balance you need so a bad stretch does not end the session." },
  { name: "Most at once", text: "The most rounds running at the same moment across all assets: how much money can be tied up at once." },
  { name: "Full loss every", text: "How often a round loses every order, e.g. 1 per 4 days." },
  { name: "Worst round", text: "The money lost when every order of one round loses." },
  { name: "When to trade", text: "Rounds grouped by the Bangkok hour they started. Green hours earned at least the average per round, teal ones earned less, red ones lost money; grey hours had fewer than 100 rounds, too few to judge." },
  { name: "Martingale levels", text: "The same signal played with no martingale, or with at most 1, 2, 3 or 4 martingale orders after the first. The switch at the top shows the whole report at one of these; the best level is the one with the most profit per day. Fewer levels lose a round more often, but each lost round costs far less." },
  { name: "Last 2 weeks", text: "The newest 14 days on their own: the first-order win there. ✅ still above break-even; ❌ not, so a good result on the older days may have been luck. Keep the newest 2 weeks for checking a setting rather than choosing it." },
  { name: "Does it hold over time?", text: "The test cut into 4 equal stretches of days, oldest first, each with its rounds a day, where rounds were won (first order, martingale 1 … 4, lost all) and how sessions did. An edge worth trading shows in every stretch; one good stretch can be luck." },
  { name: "Running martingale chains", text: "When a session ends, rounds on other assets may still be in the middle of their martingale. Let them finish: every round plays out. Stop them: no more orders once the session ends, only orders already placed count. The report plays every session both ways and marks the better one." },
];

export interface SettingGroup {
  key: string;
  name: string;
  /** What this part of the signal checks, in one or two sentences. */
  about: string;
}

export const SETTING_GROUPS: readonly SettingGroup[] = [
  { key: "supportResistance", name: "Support / resistance", about: "A box made of the highest high and lowest low of recent candles. A PUT needs the candle near the top of the box, a CALL near the bottom." },
  { key: "donchian", name: "Donchian channel", about: "The highest high and lowest low of recent candles. A PUT needs the candle to break above the channel, a CALL below it." },
  { key: "bollinger", name: "Bollinger bands", about: "Bands around the average price, as wide as the recent price swings. A PUT needs the candle's high above the upper band, a CALL its low below the lower band." },
  { key: "stochastic", name: "Stochastic", about: "Where the close sits in its recent range, 0 to 100. A PUT needs both %K and %D very high (stretched up), a CALL both very low." },
  { key: "candle", name: "Candle shape and size", about: "The signal candle must be a solid move: a big body, a small wick against the move, several candles of the same colour in a row, and not small compared with recent candles." },
  { key: "martingale", name: "Martingale", about: "What happens after a losing order: the next order goes in the same direction on the next candle with a bigger stake, up to the last level." },
  { key: "order", name: "Order", about: "The stake of the first order and the payout of a win." },
  { key: "trading", name: "Trading", about: "How many rounds the bot may have open at the same time across all assets. Rounds take about 2 minutes; usually 2 are open, but signals can come in bursts of 40 at once." },
];

/** Per setting: a friendly name and what raising it does. */
export const SETTING_GUIDE: Readonly<Record<string, GuideEntry & { higher: string }>> = {
  "supportResistance.use": { name: "Use support / resistance", text: 'Whether this rule is used: true or false. Every rule that is used must pass.', higher: "" },
  "supportResistance.period": { name: "Box length (candles)", text: "How many candles the support/resistance box covers.", higher: "Higher: a wider box, so being near its edge is rarer." },
  "supportResistance.zone": { name: "How close to the edge (0-1)", text: "How far into the top or bottom half of the box the candle must reach; 1 is the very edge.", higher: "Higher: only candles right at the edge count, fewer signals." },
  "donchian.use": { name: "Use the Donchian channel", text: 'Whether this rule is used: true or false. Every rule that is used must pass.', higher: "" },
  "donchian.period": { name: "Channel length (candles)", text: "How many candles the Donchian channel covers.", higher: "Higher: a breakout needs a longer-term high or low, fewer signals." },
  "bollinger.use": { name: "Use Bollinger bands", text: 'Whether this rule is used: true or false. Every rule that is used must pass.', higher: "" },
  "bollinger.period": { name: "Band length (candles)", text: "How many closes the Bollinger average and width use.", higher: "Higher: smoother, slower bands." },
  "bollinger.stdDev": { name: "Band width", text: "How wide the bands are, in standard deviations of recent closes.", higher: "Higher: wider bands, so poking outside is rarer, fewer signals." },
  "stochastic.use": { name: "Use the stochastic", text: 'Whether this rule is used: true or false. Every rule that is used must pass.', higher: "" },
  "stochastic.k": { name: "%K length (candles)", text: "How many candles the stochastic range covers.", higher: "Higher: a longer range, slower to reach the extremes." },
  "stochastic.d": { name: "%D length", text: "How many %K values %D averages.", higher: "Higher: a smoother, slower %D." },
  "stochastic.smooth": { name: "%K smoothing", text: "How many raw values %K averages.", higher: "Higher: a smoother, slower %K." },
  "stochastic.level": { name: "Extreme level", text: "A PUT needs %K and %D above this, a CALL below 100 minus it.", higher: "Higher: only more stretched prices count, fewer signals." },
  "candle.sameColourInARow": { name: "Same colour in a row", text: "How many candles of the same colour must come in a row, ending with the signal candle.", higher: "Higher: needs a longer run, fewer signals." },
  "candle.minBody": { name: "Minimum body (0-1)", text: "The body must be at least this share of the candle's high-to-low range.", higher: "Higher: only solid candles, fewer signals." },
  "candle.maxWick": { name: "Maximum wick against the move (0-1)", text: "The wick against the move (upper for PUT, lower for CALL) must be under this share of the range.", higher: "Higher: allows bigger wicks, more signals." },
  "candle.checkLast": { name: "Candles checked for body and wick", text: "How many latest candles must pass the body rule; the signal candle's wick must also be the smallest of them.", higher: "Higher: stricter, fewer signals." },
  "candle.minSizeVsAverage": { name: "Minimum size vs recent average", text: "The latest candles' bodies must each be at least this many times the average body of the candles before them.", higher: "Higher: needs bigger candles than usual, fewer signals." },
  "candle.sizeCandles": { name: "Candles checked for size", text: "How many latest candles the size rule applies to.", higher: "Higher: stricter, fewer signals." },
  "candle.sizeLookback": { name: "Candles in the average size", text: "How many earlier candles the average body is taken over.", higher: "Higher: a longer-term average." },
  "martingale.type": { name: "Martingale type", text: "standard: each level stakes the multiplier times the previous one. recovery: each level is sized to win back all losses plus a normal win. cover: each level is sized to win back exactly the losses, so a round won by martingale ends at 0 and only first-order wins earn.", higher: "" },
  "martingale.multiplier": { name: "Stake multiplier", text: "Standard martingale: each level stakes this times the previous one.", higher: "Higher: wins back losses faster, but a lost round costs far more." },
  "martingale.levels": { name: "Martingale levels", text: "Orders after the first one; 4 means up to 5 orders per round.", higher: "Higher: more rounds end in a win, but a lost round costs far more." },
  "order.amount": { name: "First order (THB)", text: "The stake of the first order of each round.", higher: "Higher: everything scales up, profit and losses alike." },
  "order.payout": { name: "Payout (%)", text: "Profit on a winning order, in percent of the stake.", higher: "Higher: lowers the win rate needed to break even." },
  "trading.maxOpenRounds": { name: "Most rounds open at once", text: "A new round only starts while fewer than this many rounds are running on all assets together; otherwise the signal is skipped. 0 means no limit, as the bot trades today.", higher: "Higher: more rounds, and bigger bursts when many assets signal at once." },
  hours: { name: "Hours", text: 'Only start rounds in these Bangkok hours, e.g. ["07-11", "20-23"] (the end hour is excluded). All day when left out.', higher: "" },
};
