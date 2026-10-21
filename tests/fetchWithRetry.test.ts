import { describe, expect, test } from "bun:test";
import { createFetchWithRetry } from "@/lib/http/fetchWithRetry";
import { retry } from "@/lib/retry";

function scripted(responses: (Response | Error)[]) {
  let calls = 0;
  const fn = (async () => {
    calls++;
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe("createFetchWithRetry", () => {
  test("retries network errors, 429 and 5xx, then returns the success", async () => {
    const base = scripted([new Error("reset"), new Response("", { status: 429 }), new Response("", { status: 503 }), Response.json([1])]);
    const response = await createFetchWithRetry({ fetch: base.fn, delayMs: 1 })("https://x.test");
    expect(await response.json()).toEqual([1]);
    expect(base.calls()).toBe(4);
  });

  test("returns 4xx immediately", async () => {
    const base = scripted([new Response("nope", { status: 404 })]);
    const response = await createFetchWithRetry({ fetch: base.fn, delayMs: 1 })("https://x.test");
    expect(response.status).toBe(404);
    expect(base.calls()).toBe(1);
  });

  test("gives up after the retry budget and returns the last response", async () => {
    const base = scripted([new Response("", { status: 500 }), new Response("", { status: 500 })]);
    const response = await createFetchWithRetry({ fetch: base.fn, retries: 1, delayMs: 1 })("https://x.test");
    expect(response.status).toBe(500);
  });
});

describe("retry", () => {
  test("retries until success", async () => {
    let n = 0;
    expect(await retry(async () => (++n < 3 ? Promise.reject(new Error("x")) : n), { delayMs: 1 })).toBe(3);
  });

  test("stops when shouldRetry says no", async () => {
    let n = 0;
    const result = retry(async () => { n++; throw new Error("fatal"); }, { delayMs: 1, shouldRetry: () => false });
    expect(result).rejects.toThrow("fatal");
    await result.catch(() => {});
    expect(n).toBe(1);
  });
});
