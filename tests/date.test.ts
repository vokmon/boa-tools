import { describe, expect, test } from "bun:test";
import { buildPeriod, compactDays, dayKeyOf, dayWindow, formatDateTime, overlaps, parseDayMonthYear } from "@/lib/date";

describe("date", () => {
  test("parses dd/mm/yyyy and rejects impossible dates", () => {
    expect(parseDayMonthYear("18/10/2026")).toEqual({ year: 2026, month: 10, day: 18 });
    expect(() => parseDayMonthYear("31/02/2026")).toThrow();
    expect(() => parseDayMonthYear("2026-10-18")).toThrow();
  });

  test("builds an inclusive whole-day window in Bangkok time", () => {
    const w = dayWindow("18/10/2026", "20/10/2026", "Asia/Bangkok");
    expect(w.start.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-20T16:59:59.999Z");
  });

  test("handles DST zones", () => {
    const w = dayWindow("29/03/2026", "29/03/2026", "Europe/London");
    expect(w.start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-29T22:59:59.999Z");
  });

  test("rejects a window that ends before it starts", () => {
    expect(() => dayWindow("20/10/2026", "18/10/2026", "UTC")).toThrow();
  });

  test("overlap rule", () => {
    const w = dayWindow("18/10/2026", "20/10/2026", "UTC");
    expect(overlaps(w, new Date("2026-10-01"), new Date("2026-10-18T00:00:00Z"))).toBe(true);
    expect(overlaps(w, new Date("2026-10-01"), new Date("2026-10-17T23:59:59Z"))).toBe(false);
    expect(overlaps(w, new Date("2026-10-21"), null)).toBe(false);
    expect(overlaps(w, new Date("2026-10-01"), null)).toBe(true);
  });

  test("formats in the given zone", () => {
    expect(formatDateTime(new Date("2026-10-17T17:00:00Z"), "Asia/Bangkok")).toBe("18/10/2026 00:00");
  });
});

describe("buildPeriod", () => {
  test("lists every day with its own local window", () => {
    const p = buildPeriod("30/10/2026", "02/11/2026", "Asia/Bangkok");
    expect(p.days.map((d) => d.label)).toEqual(["30/10/2026", "31/10/2026", "01/11/2026", "02/11/2026"]);
    expect(p.days.map((d) => d.key)[0]).toBe("2026-10-30");
    expect(p.days[1]!.window.start.toISOString()).toBe("2026-10-30T17:00:00.000Z");
    expect(p.window.end.toISOString()).toBe("2026-11-02T16:59:59.999Z");
  });

  test("dayKeyOf uses the local calendar day", () => {
    expect(dayKeyOf(new Date("2026-10-18T16:59:59Z"), "Asia/Bangkok")).toBe("2026-10-18");
    expect(dayKeyOf(new Date("2026-10-18T17:00:00Z"), "Asia/Bangkok")).toBe("2026-10-19");
  });
});

describe("compactDays", () => {
  test("lists short runs and collapses three or more consecutive days", () => {
    expect(compactDays(["2026-10-18", "2026-10-20"])).toBe("18/10, 20/10");
    expect(compactDays(["2026-10-18", "2026-10-19"])).toBe("18/10, 19/10");
    expect(compactDays(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-03"])).toBe("30/10 to 01/11, 03/11");
    expect(compactDays([])).toBe("");
  });
});
