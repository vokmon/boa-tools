import type { BacktestResult, SettingResult } from "../runBacktest";
import { NUMBER_FIELDS } from "../settings/fields";
import { defaultValues } from "../settings/settingsFile";
import { changesFromBot, finishedRounds, fullLossEvery, hourList, inRoundsGoal, money, ordered, percent, share } from "./format";

/**
 * A Markdown brief to paste into an AI assistant: goal, constraints, the settings format, every
 * setting tried with its results, and a request for the next settings files to try.
 */
export function aiBrief(run: BacktestResult): string {
  const rows = ordered(run.results);
  const first = rows[0]!.setting;
  const defaults = defaultValues();
  const days = run.period.days;
  const levels = Math.max(...rows.map((r) => r.setting.martingale.levels));

  const resultRows = rows.map((r) => {
    const s = r.summary;
    const finished = finishedRounds(r);
    return [
      r.setting.label,
      changesFromBot(r.setting.values).join("; ") || "(the bot's current settings)",
      `${r.groups.total.days.weekdays.roundsPerDay.toFixed(0)}${inRoundsGoal(r.groups.total.days.weekdays.roundsPerDay) ? "" : " (outside the goal)"}`,
      s.roundsPerHour.toFixed(0),
      percent(s.firstWinPct, 2),
      Array.from({ length: levels }, (_, l) => share(s.wonAtLevel[l + 1] ?? 0, finished)).join(" / "),
      share(s.lost, finished),
      money(s.profitPerDay),
      `${s.losingDays}/${s.days}`,
      s.worstDay ? money(s.worstDay.profit) : "-",
      money(s.biggestDrop),
      `${percent(s.check.before.firstWinPct, 2)} → ${percent(s.check.last.firstWinPct, 2)}, ${money(s.check.before.profitPerDay)} → ${money(s.check.last.profitPerDay)}/day ${s.check.heldUp ? "(held up)" : "(dropped)"}`,
      hourList(s.goodHours),
      hourList(s.avoidHours),
    ];
  });

  const best = (r: SettingResult) => r.byAsset.slice(0, 3).map((a) => `${a.name} ${money(a.profit)}`).join(", ");
  const worst = (r: SettingResult) => r.byAsset.slice(-3).reverse().map((a) => `${a.name} ${money(a.profit)}`).join(", ");

  return [
    "# Backtest brief: suggest the next settings to try",
    "",
    "## Goal",
    "A trading bot places digital-option orders on 1-minute candles when its signal fires, with a martingale on losses.",
    "The signal is a **reversal** signal: it bets the next candle turns back after the price has gone too far one way",
    "(stretched stochastic, at a recent high/low, outside the bands, several same-colour candles).",
    "",
    "I want a **compromise** setting that makes money across all assets per day, not one that never loses: losing rounds",
    "are fine when the other rounds cover them. Targets:",
    "- **first order wins more than the break-even below** (54.1% at 85% payout): the one number that decides profit",
    "- **600-1000 rounds a weekday**, all assets together (about 25-42 an hour; the bot trades ~880 today). About 3 in 4",
    "  rounds are on OTC assets today; main assets have ~43,000 candles a day, so the goal does not need OTC",
    "- **max martingale 4 or less** (more is too risky)",
    "- **tested at martingale x2.5 and x2.2**: put `\"multiplier\": [2.5, 2.2]` in every file you suggest",
    "- **still profitable on the newest 2 weeks**",
    "- keep the Donchian, Bollinger and support/resistance periods as they are; tune zone, stochastic level, candle rules (shape and size)",
    "- if nothing reaches the break-even at 600+ rounds a day, also suggest the best setting at fewer rounds",
    "",
    "What we know: OTC prices are made by IQ Option itself and behave like a coin flip: every test reversed 49.7-50.3% on",
    "OTC. Main assets lean toward reversing: a solid candle with no wick against the move reversed 53.4%, a long rejection",
    "wick only 49.0%. The edge shrinks as rounds grow (51.9% at ~900 a day). Volume is not used. Suggest combinations of",
    "candle shape and size that test a reversal idea, not random numbers.",
    "",
    "## How a round works",
    "Signal at a candle's close → order on the next candle (wins if it closes in the signal's direction) → on a loss, the",
    "next level on the next candle in the same direction, stake × multiplier → until a win or the last level loses",
    "(\"lost all\"). A draw repeats the same order. One asset never runs two rounds at once.",
    `At a payout of ${first.order.payout}%, an order must win ${(100 / (1 + first.order.payout / 100)).toFixed(2)}% of the time to break even; martingale`,
    "does not change that, it only moves the losses into rare \"lost all\" rounds. \"First-order win\" is that rate; \"won at any level\"",
    "is about 97% even for a coin flip with 4 levels, so it says nothing about profit.",
    "",
    "## Data",
    `${days.length} days (${days[0]} to ${days.at(-1)}, Bangkok time), ${run.assets} assets (forex, OTC, crypto, stocks),`,
    `${run.candles.toLocaleString("en-US")} one-minute candles. Order ${first.order.amount} THB, payout ${first.order.payout}%. Money in THB.`,
    "",
    "## Results so far",
    "",
    table(
      ["Setting", "Changed from the bot", "Rounds/weekday", "Rounds/hour", "First-order win", `Won at L1 / … / L${levels}`, "Lost all", "Profit/day", "Losing days", "Worst day", "Biggest drop", "First-order win and profit/day: earlier → last 2 weeks", "Good hours", "Avoid hours"],
      resultRows,
    ),
    "",
    "Main assets and OTC on their own, per weekday and per weekend day (Saturday and Sunday, Bangkok time); main assets",
    "almost stop at the weekend, OTC is open all the time:",
    "",
    table(
      ["Setting", "Group", "Rounds/weekday", "Rounds/weekend day", "First-order win weekday", "weekend", "newest 2 weeks", "Profit/weekday", "Profit/weekend day"],
      rows.flatMap((r) =>
        (["total", "main", "otc"] as const).map((key) => {
          const g = r.groups[key].days;
          const first = (stat: { roundsPerDay: number; firstWinPct: number }) => (stat.roundsPerDay > 0 ? percent(stat.firstWinPct, 2) : "-");
          return [r.setting.label, { total: "Total", main: "Main", otc: "OTC" }[key], g.weekdays.roundsPerDay.toFixed(0), g.weekend.roundsPerDay.toFixed(0), first(g.weekdays), first(g.weekend), first(g.last2Weeks), money(g.weekdays.profitPerDay), money(g.weekend.profitPerDay)];
        }),
      ),
    ),
    "",
    "Profit per day of the same signal at each martingale level (0 = no martingale):",
    "",
    table(["Setting", ...rows[0]!.levels.map((l) => (l.levels === 0 ? "No martingale" : `Up to ${l.levels}`)), "Lost all at its own level"], rows.map((r) => [r.setting.label, ...r.levels.map((l) => money(l.summary.profitPerDay)), share(r.summary.lost, finishedRounds(r))])),
    "",
    "Best and worst assets per setting:",
    "",
    ...rows.map((r) => `- **${r.setting.label}**: best ${best(r)}; worst ${worst(r)}; full loss ${fullLossEvery(r.summary.fullLossEveryDays)}`),
    "",
    "## Settings file format",
    "",
    "A JSON file with only the values to change; anything left out stays at the bot's value. A list (e.g. `\"period\": [14, 18, 22]`)",
    "tries each value. `\"hours\": [\"07-11\", \"20-23\"]` only starts rounds in those Bangkok hours. `martingale.type` is",
    "`\"standard\"` or `\"recovery\"`.",
    "",
    table(
      ["Setting", "Meaning", "Bot value", "Allowed", "Worth trying"],
      NUMBER_FIELDS.map((f) => [`\`${f.path}\``, f.about, String(defaults[f.path]), `${f.min}-${f.max}${f.integer ? ", whole" : ""}`, `${f.tryRange[0]}-${f.tryRange[1]}`]),
    ),
    "",
    "Example:",
    "",
    "```json",
    JSON.stringify({ note: "why this is worth trying", stochastic: { level: 90 }, candle: { sameColourInARow: 4 }, hours: ["07-11", "20-23"] }, null, 2),
    "```",
    "",
    "## What I need",
    "",
    "Suggest **3 to 5 new settings files** to try next. For each: a short file name (kebab-case), the JSON, and one line",
    "on why, based on the results above (which changes helped, which hurt, which hours to keep). Prefer settings that",
    "keep profit per day positive in the last 2 weeks too, lose all levels rarely, and do not need more than 4 levels.",
    "",
  ].join("\n");
}

function table(header: string[], rows: string[][]): string {
  const escape = (cell: string) => cell.replace(/\|/g, "\\|");
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(escape).join(" | ")} |`)].join("\n");
}
