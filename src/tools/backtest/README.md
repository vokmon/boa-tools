# backtest

Replays the bot on every collected 1-minute candle and shows, for each setting, how often rounds win,
at which martingale level, the profit per day, the risk, and the best hours to trade (Bangkok time).
Use it to compare settings files: your own ideas, or ones an AI suggests from the brief.

| Doc | What it holds |
|---|---|
| [docs/goals.md](docs/goals.md) | the rules a good setting is judged by, why 97% won rounds still lose, martingale x2.5 or x2.2, sessions |
| [docs/findings.md](docs/findings.md) | what the backtests and the evidence showed so far |
| [docs/plan.md](docs/plan.md) | what we test next |
| [docs/settings.md](docs/settings.md) | the settings file format and every setting |
| [docs/results.md](docs/results.md) | how a round is played, what every number means, the reversal evidence |

## Running

```
bun run backtest                     # pick from a list: All, or each settings file
bun run backtest --all               # every settings file
bun run backtest --settings bot-current,my-idea
bun run backtest --all --local       # use the local copy as it is (no Turso, no IQ Option)
bun run backtest --evidence          # reversal evidence instead of settings
```

Every run first brings Turso up to date from IQ Option (every day the broker still has, up to now)
and updates the local copy (`DATA_DIR`); the backtest then uses all complete days. Each setting is
played at max martingale 0 to 4. A few settings take ~30 s. `--local` skips the update, and needs
no IQ Option or Turso values in `.env` (e.g. when Turso's monthly write limit is used up).

`--evidence` measures how often the next candle reverses after each piece of reversal evidence,
instead of running settings files (see [docs/results.md](docs/results.md)).

| .env | What | Default |
|---|---|---|
| `BACKTEST_SETTINGS_DIR` | settings files (*.json) | `backtest/settings` |
| `BACKTEST_RESULTS_DIR` | one folder per run | `<DATA_DIR>/backtest` |
| `DATA_DIR` | local candle copy | `data` |

## Output (BACKTEST_RESULTS_DIR/<date_time>/)

| File | For |
|---|---|
| `report.html` | open it in a browser. A bar at the top picks what every table shows: assets (Total, Main, OTC) x multiplier x max martingale. Then the comparison, a tab per setting, and the explanations from docs/ |
| `results.json` | everything, for programs: per setting its values, summary (incl. per-hour and per-day) and per-asset results |
| `ai-brief.md` | paste into an AI to get the next settings files to try (see below) |
| `settings/` | every setting of the run as a settings file |
| `evidence.md`, `evidence.json` | with `--evidence` (instead of the files above): the reversal tables |

## Asking an AI for the next settings

1. Run a backtest.
2. Paste `ai-brief.md` into an AI. It has the goal, the round rules, the break-even, every setting
   tried with its results, what mattered, the settings format with ranges, and the request.
3. Save the files it suggests in the settings folder; they appear in the picker.
4. Run them, and repeat.
