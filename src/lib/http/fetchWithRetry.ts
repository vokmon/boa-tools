import { logger } from "../logger";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface FetchWithRetryOptions {
  retries?: number;
  delayMs?: number;
  fetch?: typeof fetch;
}

/**
 * A drop-in `fetch` that retries network errors and 429/5xx, honouring Retry-After.
 * Pass it to SDKs that accept a custom fetch so they survive rate limits.
 */
export function createFetchWithRetry(options: FetchWithRetryOptions = {}): typeof fetch {
  const { retries = 3, delayMs = 500, fetch: baseFetch = fetch } = options;

  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      // A Request body can only be read once, so clone it for every attempt.
      const request: typeof input = input instanceof Request ? (input.clone() as Request) : input;
      let response: Response;
      try {
        response = await baseFetch(request, init);
      } catch (error) {
        if (attempt >= retries) throw error;
        await wait(attempt, null, (error as Error).message);
        continue;
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) return response;
      await wait(attempt, response.headers.get("retry-after"), `HTTP ${response.status}`);
    }
  };

  async function wait(attempt: number, retryAfter: string | null, reason: string): Promise<void> {
    const fromHeader = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delay = Number.isFinite(fromHeader) ? fromHeader : delayMs * 2 ** attempt;
    logger.debug(`request failed (${reason}), retrying in ${delay}ms`);
    await Bun.sleep(delay);
  }

  return wrapped as typeof fetch;
}
