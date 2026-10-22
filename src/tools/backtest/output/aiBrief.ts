import type { BacktestResult, SettingResult } from "../runBacktest";
import { NUMBER_FIELDS } from "../settings/fields";
import { defaultValues } from "../settings/settingsFile";
import { changesFromBot, finishedRounds, fullLossEvery, hourList, money, ordered, percent, share } from "./format";

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
      s.roundsPerDay.toFixed(0),
      percent(s.roundWinPct, 2),
      Array.from({ length: levels + 1 }, (_, l) => share(s.wonAtLevel[l] ?? 0, finished)).join(" / "),
      share(s.lost, finished),
      money(s.profitPerDay),
      `${s.losingDays}/${s.days}`,
      s.worstDay ? money(s.worstDay.profit) : "-",
      money(s.biggestDrop),
      `${percent(s.check.before.roundWinPct, 2)} → ${percent(s.check.last.roundWinPct, 2)}, ${money(s.check.before.profitPerDay)} → ${money(s.check.last.profitPerDay)}/day ${s.check.heldUp ? "(held up)" : "(dropped)"}`,
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
    "I want a **compromise** setting that makes money across all assets per day, not one that never loses: losing rounds",
    "are fine when the other rounds cover them. Keep martingale at **4 levels or fewer** (more is too risky).",
    "",
    "## How a round works",
    "Signal at a candle's close → order on the next candle (wins if it closes in the signal's direction) → on a loss, the",
    "next level on the next candle in the same direction, stake × multiplier → until a win or the last level loses",
    "(\"lost all\"). A draw repeats the same order. One asset never runs two rounds at once.",
    `At a payout of ${first.order.payout}%, an order must win ${(100 / (1 + first.order.payout / 100)).toFixed(2)}% of the time to break even; martingale`,
    "does not change that, it only moves the losses into rare \"lost all\" rounds. \"Won at L0\" is that first-order win rate.",
    "",
    "## Data",
    `${days.length} days (${days[0]} to ${days.at(-1)}, Bangkok time), ${run.assets} assets (forex, OTC, crypto, stocks),`,
    `${run.candles.toLocaleString("en-US")} one-minute candles. Order ${first.order.amount} THB, payout ${first.order.payout}%. Money in THB.`,
    "",
    "## Results so far",
    "",
    table(
      ["Setting", "Changed from the bot", "Rounds/day", "Round win", `Won at L0 / … / L${levels}`, "Lost all", "Profit/day", "Losing days", "Worst day", "Biggest drop", "Earlier → last 2 weeks", "Good hours", "Avoid hours"],
      resultRows,
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
