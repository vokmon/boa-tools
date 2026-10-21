export interface TableColumn<T> {
  value: (row: T) => string;
  align?: "left" | "right";
  /** Longer values are cut with an ellipsis. */
  maxWidth?: number;
}

/** Terminal width of a string; handles Thai combining marks, emoji and wide characters. */
export function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

function truncate(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = "";
  for (const char of text) {
    if (displayWidth(out + char) > max - 1) break;
    out += char;
  }
  return `${out}…`;
}

function pad(text: string, width: number, align: "left" | "right"): string {
  const fill = " ".repeat(Math.max(0, width - displayWidth(text)));
  return align === "right" ? fill + text : text + fill;
}

/** Aligned rows without borders, for terminal output. */
export function renderTable<T>(rows: readonly T[], columns: readonly TableColumn<T>[], indent = "  ", gap = "   "): string[] {
  const cells = rows.map((row) => columns.map((c) => (c.maxWidth ? truncate(c.value(row), c.maxWidth) : c.value(row))));
  const widths = columns.map((_, i) => Math.max(0, ...cells.map((r) => displayWidth(r[i] ?? ""))));
  return cells.map(
    (r) =>
      indent +
      r
        .map((cell, i) => (i === columns.length - 1 ? cell : pad(cell, widths[i] ?? 0, columns[i]?.align ?? "left")))
        .join(gap)
        .trimEnd(),
  );
}
