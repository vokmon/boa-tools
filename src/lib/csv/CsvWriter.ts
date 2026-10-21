import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Writes UTF-8 with a BOM so Excel shows Thai text correctly. Creates the folder if needed. */
export async function writeCsv<T>(path: string, rows: readonly T[], columns: readonly CsvColumn<T>[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, "﻿" + toCsv(rows, columns));
}
