import { renderTable, type TableColumn } from "@/lib/output/table";
import type { BacktestResult, SettingResult } from "../runBacktest";
import { checkCell, finishedRounds, fullLossEvery, hourList, money, ordered, percent, share } from "./format";

/** The results as terminal lines: the main table, risk, when to trade, and a short legend. */
export function resultLines(run: BacktestResult): string[] {
  const rows = ordered(run.results);
  const levels = Math.max(...rows.map((r) => r.setting.martingale.levels));
  const first = rows[0]!.setting;

  const main: TableColumn<SettingResult | null>[] = [
    { value: (r) => (r ? r.setting.label : "Setting"), maxWidth: 60 },
    { value: (r) => (r ? r.summary.roundsPerDay.toFixed(0) : "Rounds/day"), align: "right" },
    { value: (r) => (r ? percent(r.summary.roundWinPct) : "Round win"), align: "right" },
    { value: (r) => (r ? share(r.summary.wonAtLevel[0] ?? 0, finishedRounds(r)) : "No mart."), align: "right" },
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

  const days = run.period.days;
  return [
    `   ${days.length} days (${days[0]} → ${days.at(-1)}, Bangkok) · ${run.assets} assets · order ${first.order.amount} THB · payout ${first.order.payout}% · martingale up to ${first.martingale.levels} levels · money in THB`,
    "",
    ...renderTable([null, ...rows], main, "   "),
    "",
    "   💰 Money and risk",
    ...renderTable([null, ...rows], risk, "   "),
    "",
    "   🕐 When to trade (Bangkok time)",
    ...renderTable([null, ...rows], hours, "   "),
    "",
    "   ℹ️  Round = one signal and its martingale orders, until a win or all orders lose.",
    "      Round win = rounds that ended in a win at any level. No mart./L1-L4 = where the win came.",
    "      Lost all = every order of the round lost. Profit = all rounds of all assets together.",
    "      Losing days = days that ended negative. Biggest drop = deepest fall from a high point (balance to keep).",
    "      Last 2 wks = round win in the newest 2 weeks; ✅ still profitable there, ⚠️ much worse (maybe luck).",
  ];
}
