import { createSentryClient as createSdkClient } from "@sentry/api";
import type { Env } from "@/config/env";
import { createFetchWithRetry } from "@/lib/http/fetchWithRetry";

export function createSentryClient(env: Env, fetchFn: typeof fetch = createFetchWithRetry()) {
  return createSdkClient({
    baseUrl: env.SENTRY_BASE_URL,
    headers: { Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}` },
    fetch: fetchFn,
  });
}

export type SentryClient = ReturnType<typeof createSentryClient>;
