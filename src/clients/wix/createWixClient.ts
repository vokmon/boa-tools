import { ApiKeyStrategy, createClient } from "@wix/sdk";
import { orders } from "@wix/pricing-plans";
import { contacts } from "@wix/crm";
import type { Env } from "@/config/env";

export function createWixClient(env: Env) {
  return createClient({
    modules: { orders, contacts },
    auth: ApiKeyStrategy({ apiKey: env.WIX_API_KEY, siteId: env.WIX_SITE_ID }),
  });
}

export type WixClient = ReturnType<typeof createWixClient>;
