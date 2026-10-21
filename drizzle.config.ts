import { join } from "node:path";
import { defineConfig } from "drizzle-kit";
import { dataDir } from "./src/config/env";

// Only used by `bun run db:studio` to browse the candles database; there is no Drizzle schema.
export default defineConfig({
  dialect: "sqlite",
  dbCredentials: { url: `file:${join(dataDir(), "candles.sqlite")}` },
});
