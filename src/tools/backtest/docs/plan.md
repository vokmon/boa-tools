# Plan: how we test from here

The next steps, from what [findings.md](findings.md) showed, against the rules in [goals.md](goals.md).
Tick a step off when it is done, and record what it showed in findings.md.

Reason from the reversal idea instead of trying random numbers.
- [x] 1. Every result shows **Main, OTC and Total** separately (rounds per day, first-order win, newest 2
         weeks, profit per day), so an edge on one group is not hidden by the other. Each is split into
         **weekdays and weekends** too: main assets almost stop at the weekend (see findings.md), so an
         average over all days hides how busy a setting is on a normal trading day. The 600-1000 rounds
         goal is judged on weekdays.
- [ ] 2. **Sessions in the backtest** (see goals.md), as decided on 22/10/2026:
         - settings files list whole session rules, each one compared on its own:
           ```json
           "sessions": [
             { "minutes": 30, "takeProfit": 10, "stopLossRounds": 1 },
             { "minutes": 30, "takeProfit": 30, "stopLossRounds": 1 },
             { "minutes": 60, "takeProfit": 10, "stopLossRounds": 1 },
             { "minutes": 60, "takeProfit": 30, "stopLossRounds": 2 }
           ]
           ```
         - `takeProfit` is in times the first order (10 = 300 THB with the 30 THB minimum order);
           `stopLossRounds` is how many fully lost rounds the session may lose (1 = 1,933 THB at x2.5,
           1,263 at x2.2), so one set of rules fits every multiplier and amount; the report shows THB
         - a round still running at a stop is finished
         - research tries a session starting at every hour (00:00 … 23:00) of every day, to find the
           good start hours; fixed start times can come later
         - results per session: the share hitting take-profit / stop-loss / time, the average, worst
           session and longest losing streak, per start hour
- [ ] 3. **Report redesign around sessions**: the verdict first, cards with a status, the first-order
         win with its margin of error (± and "surely above / can't tell / surely below").
- [ ] 4. Measure **combinations** of evidence from the candles: size, body, wick, same colour in a row,
         stochastic, box position, band and hour with each other, on main and on OTC separately, so OTC
         gets a fair second chance.
- [ ] 5. Build settings only from combinations that stay above break-even on the older days **and** the
         newest 2 weeks, with enough candles there. Judge the edge per group (trade OTC only if OTC itself
         passes) and per session.
- [ ] 6. Show the trade-off between first-order win and rounds per hour, and choose where to sit on it.
