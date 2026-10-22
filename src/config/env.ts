import { z } from "zod";

const EnvSchema = z.object({
  WIX_API_KEY: z.string().min(1),
  WIX_SITE_ID: z.string().min(1),
  SENTRY_AUTH_TOKEN: z.string().min(1),
  SENTRY_ORG: z.string().min(1),
  SENTRY_BASE_URL: z.url().default("https://sentry.io"),
});

const IqOptionEnvSchema = z.object({
  IQ_OPTION_USER: z.string().min(1),
  IQ_OPTION_PASSWORD: z.string().min(1),
});

const TursoEnvSchema = z.object({
  TURSO_DATABASE_URL: z.string().startsWith("libsql://", "expected libsql://<database>.turso.io"),
  TURSO_AUTH_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;
export type IqOptionEnv = z.infer<typeof IqOptionEnvSchema>;
export type TursoEnv = z.infer<typeof TursoEnvSchema>;

/** Reads and validates env vars. Bun loads `.env` automatically. Throws listing every missing key. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(EnvSchema, source);
}

/** IQ Option login only, for tools that talk to the broker and nothing else. */
export function loadIqOptionEnv(source: Record<string, string | undefined> = process.env): IqOptionEnv {
  return parseEnv(IqOptionEnvSchema, source);
}

/** Folder for files tools write (candles cache, reports). `DATA_DIR` in .env, default `data`. */
export function dataDir(source: Record<string, string | undefined> = process.env): string {
  return source.DATA_DIR?.trim() || "data";
}

/** Turso database that holds the candles. */
export function loadTursoEnv(source: Record<string, string | undefined> = process.env): TursoEnv {
  return parseEnv(TursoEnvSchema, source);
}

/** Folder with backtest settings files (*.json). `BACKTEST_SETTINGS_DIR` in .env, default `backtest/settings`. */
export function backtestSettingsDir(source: Record<string, string | undefined> = process.env): string {
  return source.BACKTEST_SETTINGS_DIR?.trim() || "backtest/settings";
}

/** Folder for backtest results, one subfolder per run. `BACKTEST_RESULTS_DIR` in .env, default `<DATA_DIR>/backtest`. */
export function backtestResultsDir(source: Record<string, string | undefined> = process.env): string {
  return source.BACKTEST_RESULTS_DIR?.trim() || `${dataDir(source)}/backtest`;
}

function parseEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>): z.infer<S> {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment, check .env:\n${problems}`);
  }
  return result.data;
}
