# Plan: how we test from here

The next steps, from what [findings.md](findings.md) showed, against the rules in [goals.md](goals.md).
Tick a step off when it is done, and record what it showed in findings.md.

Reason from the reversal idea instead of trying random numbers.
- [ ] 1. Every result shows **Main, OTC and Total** separately (rounds per day, first-order win, newest 2
         weeks, profit per day), so an edge on one group is not hidden by the other. Each is split into
         **weekdays and weekends** too: main assets almost stop at the weekend (see findings.md), so an
         average over all days hides how busy a setting is on a normal trading day. The 600-1000 rounds
         goal is judged on weekdays.
- [ ] 2. Measure **combinations** of evidence: volume x each other piece of evidence on main assets, and
         price x price on main and on OTC separately, so OTC gets a fair second chance.
- [ ] 3. Build settings only from combinations that stay above break-even on the older days **and** the
         newest 2 weeks, with enough candles there. Judge the edge per group (trade OTC only if OTC itself
         passes) and the rounds goal on the Total.
- [ ] 4. Show the trade-off between first-order win and rounds per day, and choose where to sit on it.
- [ ] 5. Then sessions: play only inside trading sessions and show how many sessions end positive.
