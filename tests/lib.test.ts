import { describe, expect, test } from "bun:test";
import { chunk, groupBy, uniq } from "@/lib/collections";
import { mapWithConcurrency } from "@/lib/concurrency";
import { escapeCsvCell, toCsv } from "@/lib/csv/CsvWriter";

describe("collections", () => {
  test("chunk, uniq, groupBy", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(uniq(["a", "b", "a"])).toEqual(["a", "b"]);
    expect([...groupBy([1, 2, 3, 4], (n) => n % 2)]).toEqual([[1, [1, 3]], [0, [2, 4]]]);
  });
});

describe("mapWithConcurrency", () => {
  test("keeps order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await Bun.sleep(n);
      active--;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});

describe("csv", () => {
  test("escapes quotes, commas and newlines", () => {
    expect(escapeCsvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell("ทดลอง")).toBe("ทดลอง");
  });

  test("renders header and rows", () => {
    const csv = toCsv([{ n: 1 }, { n: 2 }], [{ header: "n", value: (r) => r.n }]);
    expect(csv).toBe("n\r\n1\r\n2\r\n");
  });
});
