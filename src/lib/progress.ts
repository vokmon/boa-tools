/**
 * Readable progress output for long runs: a title, numbered steps, tasks with indented details,
 * live progress bars and timings. Writes to stderr, like the logger, so stdout stays free for data.
 *
 *   🧪 Backtest
 *   ① Data
 *      🔍 Missing candles
 *         📋 166 assets · 59 days
 *         ⏳ ████████░░░░  42/59 days
 *         ✅ Nothing missing          8.1s
 */

const STEP_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
const BAR_WIDTH = 20;
const RULE = "─".repeat(52);

export interface ProgressOutput {
  write(text: string): void;
  /** A terminal: bars redraw in place and times are dimmed. */
  isTTY: boolean;
}

const stderr: ProgressOutput = {
  write: (text) => process.stderr.write(text),
  isTTY: Boolean(process.stderr.isTTY),
};

export class Progress {
  private stepCount = 0;

  constructor(private readonly out: ProgressOutput = stderr) {}

  title(text: string): void {
    this.out.write(`\n🧪 ${text}\n${this.dim(RULE)}\n`);
  }

  /** A numbered step: ① Data, ② Signals, ... */
  step(text: string): void {
    const number = STEP_NUMBERS[this.stepCount++] ?? `${this.stepCount}.`;
    this.out.write(`\n${number} ${text}\n`);
  }

  /** A task inside the current step; details, bars and the result are indented under it. */
  task(icon: string, text: string): Task {
    this.out.write(`   ${icon} ${text}\n`);
    return new Task(this.out, (s) => this.dim(s));
  }

  private dim(text: string): string {
    return this.out.isTTY ? `\x1b[2m${text}\x1b[0m` : text;
  }
}

export class Task {
  private readonly startedAt = Date.now();
  private barVisible = false;

  constructor(
    private readonly out: ProgressOutput,
    private readonly dim: (text: string) => string,
  ) {}

  info(icon: string, text: string): void {
    this.clearBar();
    this.out.write(`      ${icon} ${text}\n`);
  }

  warn(text: string): void {
    this.info("⚠️ ", text);
  }

  /** A progress bar for `total` units; call update() as work completes. */
  bar(total: number, unit: string): Bar {
    return new Bar(total, unit, (line, final) => {
      if (this.out.isTTY) {
        this.out.write(`\r\x1b[2K      ⏳ ${line}`);
        this.barVisible = !final;
        if (final) this.out.write("\r\x1b[2K");
      } else if (!final) {
        this.out.write(`      ⏳ ${line}\n`);
      }
    }, this.out.isTTY);
  }

  /** Ends the task with ✅ and how long it took. */
  done(text: string): void {
    this.finish("✅", text);
  }

  fail(text: string): void {
    this.finish("❌", text);
  }

  private finish(icon: string, text: string): void {
    this.clearBar();
    const seconds = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    this.out.write(`      ${icon} ${text.padEnd(44)} ${this.dim(`${seconds}s`)}\n`);
  }

  private clearBar(): void {
    if (this.barVisible) {
      this.out.write("\r\x1b[2K");
      this.barVisible = false;
    }
  }
}

export class Bar {
  private done = 0;
  private lastQuarter = 0;

  constructor(
    private readonly total: number,
    private readonly unit: string,
    private readonly draw: (line: string, final: boolean) => void,
    private readonly live: boolean,
  ) {}

  /** Adds `n` finished units and redraws (every unit on a terminal, every 25% otherwise). */
  update(n = 1): void {
    this.done = Math.min(this.total, this.done + n);
    const quarter = Math.floor((this.done / Math.max(1, this.total)) * 4);
    if (this.live || (quarter > this.lastQuarter && this.done < this.total)) {
      this.lastQuarter = quarter;
      this.draw(this.line(), false);
    }
  }

  /** Removes the bar; the task's done() line replaces it. */
  end(): void {
    this.draw(this.line(), true);
  }

  private line(): string {
    const filled = Math.round((this.done / Math.max(1, this.total)) * BAR_WIDTH);
    return `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}  ${this.done.toLocaleString("en-US")}/${this.total.toLocaleString("en-US")} ${this.unit}`;
  }
}

/** 11411939 -> "11.4M", 52742 -> "52.7k", 950 -> "950". */
export function compactNumber(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

/** "2026-10-21" -> "21/10" */
export function shortDay(day: string): string {
  const [, month, d] = day.split("-");
  return `${d}/${month}`;
}
