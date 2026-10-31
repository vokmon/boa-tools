import { ApiKeyStrategy, createClient } from "@wix/sdk";
import { orders } from "@wix/pricing-plans";
import { contacts } from "@wix/crm";
import { members } from "@wix/members";
import { participants, programs } from "@wix/online-programs";
import type { Env } from "@/config/env";

export function createWixClient(env: Env) {
  return createClient({
    modules: { orders, contacts, members, participants, programs },
    auth: ApiKeyStrategy({ apiKey: env.WIX_API_KEY, siteId: env.WIX_SITE_ID }),
  });
}

export type WixClient = ReturnType<typeof createWixClient>;
