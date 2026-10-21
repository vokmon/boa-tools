import { retry } from "@/lib/retry";
import type { WixClient } from "./createWixClient";
import type { WixOrder } from "./types";

const PAGE_SIZE = 50;

/** Wix Pricing Plans orders (the site's subscriptions). */
export class PricingPlanOrdersService {
  constructor(private readonly wix: Pick<WixClient, "orders">) {}

  async *iterateOrders(): AsyncGenerator<WixOrder> {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await retry(() => this.wix.orders.managementListOrders({ limit: PAGE_SIZE, offset }), {
        label: "Wix list orders",
      });
      const items = page.orders ?? [];
      yield* items;
      const total = page.pagingMetadata?.total ?? 0;
      if (items.length === 0 || offset + items.length >= total) return;
    }
  }

  async listOrders(): Promise<WixOrder[]> {
    return Array.fromAsync(this.iterateOrders());
  }
}
