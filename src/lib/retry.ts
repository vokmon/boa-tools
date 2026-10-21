import { logger } from "./logger";

export interface RetryOptions {
  retries?: number;
  /** Base delay for exponential backoff. */
  delayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  label?: string;
}

/** Runs `fn`, retrying failures with exponential backoff. Use only for idempotent reads. */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, delayMs = 500, shouldRetry = () => true, label = "call" } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = delayMs * 2 ** attempt;
      logger.debug(`${label} failed (${(error as Error)?.message ?? error}), retrying in ${delay}ms`);
      await Bun.sleep(delay);
    }
  }
}
