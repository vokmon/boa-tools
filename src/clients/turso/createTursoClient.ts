import { createClient, type Client } from "@libsql/client";
import type { TursoEnv } from "@/config/env";

export function createTursoClient(env: TursoEnv): Client {
  return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}
