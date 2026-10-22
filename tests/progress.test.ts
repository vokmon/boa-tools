import { describe, expect, test } from "bun:test";
import { Progress, compactNumber, shortDay } from "@/lib/progress";

function capture(isTTY: boolean) {
  const lines: string[] = [];
  return { out: { write: (t: string) => void lines.push(t), isTTY }, text: () => lines.join("") };
}

describe("Progress", () => {
  test("steps, indented task details and a timed result", () => {
    const { out, text } = capture(false);
    const progress = new Progress(out);
    progress.title("Backtest");
    progress.step("Data");
    const task = progress.task("🔍", "Missing candles");
    task.info("📋", "166 assets");
    task.done("Nothing missing");
    progress.step("Signals");
    expect(text()).toMatch(/🧪 Backtest\n─+\n\n① Data\n   🔍 Missing candles\n      📋 166 assets\n      ✅ Nothing missing +\d+\.\ds\n\n② Signals\n/);
  });

  test("without a terminal the bar prints at 25%, 50% and 75%", () => {
    const { out, text } = capture(false);
    const bar = new Progress(out).task("🔄", "Copy").bar(8, "requests");
    for (let i = 0; i < 8; i++) bar.update();
    bar.end();
    const bars = text().split("\n").filter((l) => l.includes("⏳"));
    expect(bars.map((l) => l.trim().split("  ")[1])).toEqual(["2/8 requests", "4/8 requests", "6/8 requests"]);
  });

  test("in a terminal the bar redraws one line in place", () => {
    const { out, text } = capture(true);
    const bar = new Progress(out).task("🔄", "Copy").bar(2, "requests");
    bar.update();
    bar.update();
    bar.end();
    expect(text()).not.toContain("⏳ ██████████░░░░░░░░░░  1/2 requests\n");
    expect(text()).toContain("\r\x1b[2K      ⏳ ████████████████████  2/2 requests");
  });
});

describe("formatting", () => {
  test("compact numbers and short days", () => {
    expect([compactNumber(11_411_939), compactNumber(52_742), compactNumber(950)]).toEqual(["11.4M", "52.7k", "950"]);
    expect(shortDay("2026-10-21")).toBe("21/10");
  });
});
