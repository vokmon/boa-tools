import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_ORDER } from "@/domain/backtest/martingale";
import { renderTable, type TableColumn } from "@/lib/output/table";
import { breakEvenPct, percent } from "../output/format";
import { rate, type BucketResult, type EvidenceRun, type Tally } from "./reversalEvidence";

/** A group needs this many candles in the newest 2 weeks before its result counts as lasting. */
const MIN_NEWEST = 200;

const all = (b: BucketResult): Tally[] => [b.otc.older, b.otc.newest, b.main.older, b.main.newest];
const candles = (tallies: readonly Tally[]) => tallies.reduce((n, t) => n + t.candles, 0);
const cell = (value: number) => (Number.isNaN(value) ? "-" : percent(value));

/**
 * Groups (all assets, OTC, main) where the bucket reverses above break-even on the older days and
 * again on the newest 2 weeks: evidence worth building on.
 */
function lasting(b: BucketResult, breakEven: number): string[] {
  const groups: [string, Tally, Tally][] = [
    ["all", sumOf([b.otc.older, b.main.older]), sumOf([b.otc.newest, b.main.newest])],
    ["OTC", b.otc.older, b.otc.newest],
    ["main", b.main.older, b.main.newest],
  ];
  return groups.filter(([, older, newest]) => newest.candles >= MIN_NEWEST && rate([older]) > breakEven && rate([newest]) > breakEven).map(([name]) => name);
}

function sumOf(tallies: readonly Tally[]): Tally {
  return { candles: candles(tallies), reversed: tallies.reduce((n, t) => n + t.reversed, 0) };
}

interface Row {
  bucket: string;
  perDay: string;
  all: string;
  otc: string;
  main: string;
  older: string;
  newest: string;
  lasts: string;
}

function rows(run: EvidenceRun, buckets: readonly BucketResult[]): Row[] {
  const breakEven = breakEvenPct(DEFAULT_ORDER.payout);
  const days = run.period.days.length;
  return buckets.map((b) => {
    const passes = lasting(b, breakEven);
    return {
      bucket: b.name,
      perDay: Math.round(candles(all(b)) / days).toLocaleString("en-US"),
      all: cell(rate(all(b))),
      otc: cell(rate([b.otc.older, b.otc.newest])),
      main: cell(rate([b.main.older, b.main.newest])),
      older: cell(rate([b.otc.older, b.main.older])),
      newest: cell(rate([b.otc.newest, b.main.newest])),
      lasts: passes.length ? `✅ ${passes.join(", ")}` : "",
    };
  });
}

const HEADERS: Record<keyof Row, string> = {
  bucket: "",
  perDay: "Candles/day",
  all: "Reversed",
  otc: "OTC",
  main: "Main",
  older: "Older days",
  newest: "Newest 2 wks",
  lasts: "Lasts",
};

/** The evidence as terminal lines: a table per piece of evidence. */
export function evidenceLines(run: EvidenceRun): string[] {
  const breakEven = breakEvenPct(DEFAULT_ORDER.payout);
  const days = run.period.days;
  const lines = [
    `   ${days.length} days (${days[0]} → ${days.at(-1)}, Bangkok) · ${run.assets} assets · newest ${run.checkDays} days kept for checking`,
    `   Reversed = the next candle closed against this one (a PUT after green, a CALL after red would win). Break-even ${percent(breakEven, 2)}.`,
    `   ✅ = above break-even on the older days and again on the newest 2 weeks (at least ${MIN_NEWEST} candles there), for all assets, OTC or main.`,
  ];
  for (const e of run.evidence) {
    const columns = (Object.keys(HEADERS) as (keyof Row)[]).map((key, i): TableColumn<Row | null> => ({
      value: (r) => (r ? r[key] : i === 0 ? e.name : HEADERS[key]),
      align: i === 0 || key === "lasts" ? "left" : "right",
      ...(i === 0 ? { maxWidth: 40 } : {}),
    }));
    lines.push("", ...renderTable([null, ...rows(run, e.buckets)], columns, "   "));
  }
  return lines;
}

/** Writes evidence.md (the tables with what each piece of evidence means) and evidence.json. */
export async function writeEvidenceFiles(dir: string, run: EvidenceRun): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "evidence.json"), JSON.stringify(run, null, 1));
  const breakEven = breakEvenPct(DEFAULT_ORDER.payout);
  const days = run.period.days;
  const md = [
    "# Reversal evidence",
    "",
    `${days.length} days (${days[0]} to ${days.at(-1)}, Bangkok time), ${run.assets} assets, ${run.candles.toLocaleString("en-US")} one-minute candles.`,
    "",
    "Every candle with a colour is a possible signal: after a green candle the reversal bet is a PUT, after a red one a CALL.",
    `**Reversed** = the next candle closed the other way (draws left out). At 85% payout a bet needs more than ${percent(breakEven, 2)} to make money.`,
    `**Lasts** ✅ = above break-even on the older days and again on the newest ${run.checkDays} days (at least ${MIN_NEWEST} candles there), for all assets, OTC or main.`,
    "",
    ...run.evidence.flatMap((e) => [
      `## ${e.name}`,
      "",
      e.about,
      "",
      `| ${(Object.keys(HEADERS) as (keyof Row)[]).map((k, i) => (i === 0 ? "" : HEADERS[k])).join(" | ")} |`,
      `|${Object.keys(HEADERS).map(() => "---").join("|")}|`,
      ...rows(run, e.buckets).map((r) => `| ${Object.values(r).join(" | ")} |`),
      "",
    ]),
  ].join("\n");
  await Bun.write(join(dir, "evidence.md"), md);
  return ["evidence.md", "evidence.json"];
}
