import { z } from "zod";

const EnvSchema = z.object({
  WIX_API_KEY: z.string().min(1),
  WIX_SITE_ID: z.string().min(1),
  SENTRY_AUTH_TOKEN: z.string().min(1),
  SENTRY_ORG: z.string().min(1),
  SENTRY_BASE_URL: z.url().default("https://sentry.io"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Reads and validates env vars. Bun loads `.env` automatically. Throws listing every missing key. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment, check .env:\n${problems}`);
  }
  return result.data;
}
