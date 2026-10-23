# Findings

What the backtests and the evidence showed, newest data range in each heading. The rules they are
judged by are in [goals.md](goals.md); what we test next is in [plan.md](plan.md).

## 24/08-21/10/2026

- The bot's current settings: the first order wins **50.6%**, the same as a random candle; the
  martingale turns that into 97% won rounds but loses about 13,300 THB a day (30 THB orders).
- Of about 2,600 combinations of zone, stochastic level, candle rules and volume, plus 26 built from
  reversal ideas (stretched, long same-colour run, big last candle, at the high/low, solid last push),
  the ones with 600+ rounds a day all stay at **50-51%**: they change how often the bot trades, not how
  often it is right. `supportResistance.zone` 0.95-1.0 barely changes anything.
- **OTC assets behave like a coin flip.** IQ Option makes OTC prices itself (no exchange, no other
  traders). We store a volume for every candle, but for OTC it is always 0 (0 of 8.05 M candles). Over
  those 8 M candles the next candle reversed 50.0%, and it stays at 50% whatever we know about the
  candle:

  | What we know about the OTC candle | Next candle reversed |
  |---|---|
  | Anything (all candles) | 50.0% |
  | 6+ same colour in a row | 50.1% |
  | Stochastic 95+ (very stretched) | 50.0% |
  | A new 25-candle high/low | 50.1% |
  | Body 3x the average | 49.9% |
  | Any hour of the day | 49.8-50.2% |
  | The bot's signal fired | 50.3% |

  Like a fair coin after 5 heads in a row, the past says nothing about the next candle, and 50%
  reversal also means 50% continuation, so OTC does not trend either. 76 setting combinations gave
  49.7-50.3% on OTC. "Coin flip" sums up what we tested one at a time; combinations give OTC a second
  chance. About 3 in 4 of the bot's rounds today are on OTC.
- **Main assets lean toward reversing**, and carry volume: it is filled in on 83% of main-asset
  candles (2.79 M of 3.36 M). Some main assets have none at all (e.g. AMAZON-op is 0 on every candle),
  and the volume rule skipped those too. A solid candle with no wick against the move reversed 53.4%. A
  long rejection wick reversed 49.0%, worse than random, so the classic rejection wick does not work
  here. A **volume spike** with the signal was the strongest edge: 53.9% at 89 rounds a day (56.1% in
  the newest 2 weeks), and 55-60% at 9-50 rounds a day.
- **Volume dropped (23/10/2026).** Only main assets have it, and it made too little difference to build
  on (one setting near break-even at ~90 rounds a day). The signal is tuned with the candles' shape and
  size instead; the stored candles keep their volume.
- **The edge shrinks as rounds grow**: on main assets 53.9% at 89 a day, 52.4% at ~150, 51.9% at ~900.
- Main assets have about 43,000 candles a day, so 600 rounds a day needs about 1 in 70 of them: the
  rounds goal does not depend on OTC. Main assets only trade in market hours (see below).
- **When each group trades** (assets with candles in that hour, Bangkok time):

  | When (Bangkok) | Main (72 assets) | OTC (94 assets) |
  |---|---|---|
  | Mon 04:00 | ~30-40: the week opens (forex) | ~90-100, always open |
  | Weekdays 07:00-14:00 | ~41-46: Asia and forex | |
  | Weekdays 15:00-19:00 | ~55-62: Europe's stocks and indices open | |
  | Weekdays 20:00-02:00 | **~60-73, the most**: US stocks open too | |
  | Weekdays 03:00-06:00 | ~36-56: US closes | |
  | Sat ~04:00 to Mon 04:00 | **~3**: only crypto, which never closes | |

  OTC never closes, which fits prices the broker makes itself. Main assets trade from Monday 04:00 to
  Saturday about 04:00, busiest in the Thai evening (20:00-02:00). So **weekends are basically OTC
  only**, and a main-only setting is nearly idle from Saturday morning to Monday morning; its rounds a
  day should be judged on weekdays.
- With a below-break-even first order, every martingale level loses more; no martingale loses least.
- **Margin of error matters.** The bot's main assets at the weekend won 55.8% on the first order, but
  on only 725 rounds: ±3.6, so the true rate is somewhere between 52.2% and 59.4%. Too few rounds to
  call it an edge. Every other group of the bot is surely below break-even (e.g. all assets 50.6%
  ±0.4).
- How busy the bot's current settings feel: 26-41 rounds an hour depending on the hour, a new round
  about every 2 minutes (9 in 10 gaps 5 minutes or less), no order open about a third of the time.
