import { describe, expect, test } from "bun:test";
import { MessageTimeseriesService } from "@/clients/sentry/MessageTimeseriesService";
import { createSentryClient } from "@/clients/sentry/createSentryClient";
import type { Env } from "@/config/env";

const env: Env = {
  WIX_API_KEY: "k",
  WIX_SITE_ID: "s",
  SENTRY_AUTH_TOKEN: "t",
  SENTRY_ORG: "org",
  SENTRY_BASE_URL: "https://sentry.test",
};
const window = { start: new Date("2026-10-17T17:00:00Z"), end: new Date("2026-10-20T16:59:59.999Z") };
const H = 3_600_000;
const T0 = window.start.getTime();

/** Runs the real Sentry SDK against a fake fetch, so the test covers the SDK request too. */
function service(seriesPerCall: [number, number][][], seen: Request[]) {
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(input instanceof Request ? input : new Request(String(input), init));
    const values = (seriesPerCall.shift() ?? []).map(([timestamp, value]) => ({ timestamp, value, incomplete: false }));
    return Response.json({ timeSeries: [{ values, yAxis: "count()", meta: { valueType: "integer", valueUnit: null, interval: H } }] });
  }) as unknown as typeof fetch;
  return new MessageTimeseriesService(createSentryClient(env, fakeFetch), "org");
}

describe("MessageTimeseriesService", () => {
  test("sums datasets per bucket, drops empty buckets and sends the right query", async () => {
    const seen: Request[] = [];
    const buckets = await service(
      [
        [[T0, 2], [T0 + H, 0], [T0 + 2 * H, 1]],
        [[T0, 3], [T0 + 5 * H, 4]],
      ],
      seen,
    ).countMessagesContaining("100000001", { window, projectIds: ["1", "2"], datasets: ["logs", "errors"], environment: "production" });

    expect(buckets).toEqual([
      { start: new Date(T0), count: 5 },
      { start: new Date(T0 + 2 * H), count: 1 },
      { start: new Date(T0 + 5 * H), count: 4 },
    ]);
    expect(seen).toHaveLength(2);
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe("https://sentry.test/api/0/organizations/org/events-timeseries/");
    expect(url.searchParams.get("dataset")).toBe("logs");
    expect(url.searchParams.get("query")).toBe("message:*100000001*");
    expect(url.searchParams.get("interval")).toBe("3600");
    expect(url.searchParams.getAll("environment")).toEqual(["production"]);
    expect(url.searchParams.getAll("project")).toEqual(["1", "2"]);
    expect(url.searchParams.get("start")).toBe("2026-10-17T17:00:00.000Z");
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer t");
    expect(new URL(seen[1]!.url).searchParams.get("dataset")).toBe("errors");
  });

  test("refuses text that would break the search syntax", async () => {
    expect(service([], []).countMessagesContaining('1* OR "x', { window, projectIds: ["1"], datasets: ["logs"] })).rejects.toThrow();
  });
});
