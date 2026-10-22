import { renderTable, type TableColumn } from "@/lib/output/table";
import type { BacktestResult, SettingResult } from "../runBacktest";
import { ROUNDS_PER_DAY_GOAL } from "@/domain/backtest/summary";
import { breakEvenPct, checkCell, finishedRounds, fullLossEvery, hourList, money, ordered, percent, quietCell, roundsCell, share } from "./format";

/** The results as terminal lines: the main table, risk, when to trade, and a short legend. */
export function resultLines(run: BacktestResult): string[] {
  const rows = ordered(run.results);
  const levels = Math.max(...rows.map((r) => r.setting.martingale.levels));
  const first = rows[0]!.setting;

  const main: TableColumn<SettingResult | null>[] = [
    { value: (r) => (r ? r.setting.label : "Setting"), maxWidth: 60 },
    { value: (r) => (r ? roundsCell(r.summary.roundsPerDay) : "Rounds/day"), align: "right" },
    { value: (r) => (r ? r.summary.roundsPerHour.toFixed(0) : "Per hour"), align: "right" },
    { value: (r) => (r ? quietCell(r.summary.quietMinutes) : "Quiet"), align: "right" },
    { value: (r) => (r ? `${r.summary.firstWinPct >= breakEvenPct(r.setting.order.payout) ? "✅" : "❌"} ${percent(r.summary.firstWinPct)}` : "First order"), align: "right" },
    { value: (r) => (r ? percent(r.summary.roundWinPct) : "Any level"), align: "right" },
    ...Array.from({ length: levels }, (_, i): TableColumn<SettingResult | null> => ({
      value: (r) => (r ? (i + 1 <= r.setting.martingale.levels ? share(r.summary.wonAtLevel[i + 1] ?? 0, finishedRounds(r)) : "-") : `L${i + 1}`),
      align: "right",
    })),
    { value: (r) => (r ? share(r.summary.lost, finishedRounds(r)) : "Lost all"), align: "right" },
    { value: (r) => (r ? money(r.summary.profit) : "Profit"), align: "right" },
    { value: (r) => (r ? money(r.summary.profitPerDay) : "Per day"), align: "right" },
    { value: (r) => (r ? `${r.summary.losingDays}/${r.summary.days}` : "Losing days"), align: "right" },
    { value: (r) => (r ? (r.summary.worstDay ? money(r.summary.worstDay.profit) : "-") : "Worst day"), align: "right" },
    { value: (r) => (r ? checkCell(r) : "Last 2 wks") },
  ];

  const risk: TableColumn<SettingResult | null>[] = [
    { value: (r) => (r ? r.setting.label : "Setting"), maxWidth: 60 },
    { value: (r) => (r ? fullLossEvery(r.summary.fullLossEveryDays) : "Full loss every") },
    { value: (r) => (r ? money(r.summary.biggestDrop) : "Biggest drop"), align: "right" },
    { value: (r) => (r ? String(r.summary.mostAtOnce) : "Most at once"), align: "right" },
    { value: (r) => (r ? money(-r.worstCaseStake) : "Worst round"), align: "right" },
  ];

  const hours: TableColumn<SettingResult | null>[] = [
    { value: (r) => (r ? r.setting.label : "Setting"), maxWidth: 60 },
    { value: (r) => (r ? `✅ ${hourList(r.summary.goodHours)}` : "Good hours") },
    { value: (r) => (r ? `❌ ${hourList(r.summary.avoidHours)}` : "Avoid") },
  ];

  const levelCols: TableColumn<SettingResult | null>[] = [
    { value: (r) => (r ? r.setting.label : "Setting"), maxWidth: 60 },
    ...rows[0]!.levels.map((l, i): TableColumn<SettingResult | null> => ({
      value: (r) => (r ? money(r.levels[i]!.summary.profitPerDay) : l.levels === 0 ? "No mart." : `Up to ${l.levels}`),
      align: "right",
    })),
    { value: (r) => (r ? `⭐ ${[...r.levels].sort((a, b) => b.summary.profitPerDay - a.summary.profitPerDay)[0]!.levels}` : "Best") },
  ];

  const days = run.period.days;
  return [
    `   ${days.length} days (${days[0]} → ${days.at(-1)}, Bangkok) · ${run.assets} assets · order ${first.order.amount} THB · payout ${first.order.payout}% · martingale up to ${first.martingale.levels} levels · money in THB`,
    "",
    ...renderTable([null, ...rows], main, "   "),
    "",
    "   💰 Money and risk",
    ...renderTable([null, ...rows], risk, "   "),
    "",
    "   🎚️  Martingale levels: profit per day of the same signal with 0 … 4 martingale orders",
    ...renderTable([null, ...rows], levelCols, "   "),
    "",
    "   🕐 When to trade (Bangkok time)",
    ...renderTable([null, ...rows], hours, "   "),
    "",
    "   ℹ️  Round = one signal and its martingale orders, until a win or all orders lose.",
    `      Rounds/day ✅ = inside the goal of ${ROUNDS_PER_DAY_GOAL.min}-${ROUNDS_PER_DAY_GOAL.max}. Quiet = 9 in 10 waits for a new round are this long or shorter.`,
    `      First order = how often the first order wins; ✅ above ${percent(breakEvenPct(first.order.payout), 2)}, the break-even, the one number that decides profit.`,
    "      Any level = rounds won at any level (high even for a bad setting). L1-L4 = rounds won at that martingale level.",
    "      Lost all = every order of the round lost. Profit = all rounds of all assets together.",
    "      Losing days = days that ended negative. Biggest drop = deepest fall from a high point (balance to keep).",
    "      Last 2 wks = first-order win and profit per day in the newest 2 weeks; ✅ still profitable, ⚠️ much worse (maybe luck).",
  ];
}
