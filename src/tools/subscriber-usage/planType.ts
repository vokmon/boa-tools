import type { WixOrder } from "@/clients/wix/types";
import { planTypeOf } from "@/domain/subscriptions";
import type { PlanFilter } from "./types";

export { planTypeOf };

export function matchesPlanFilter(order: WixOrder, filter: PlanFilter): boolean {
  return filter === "all" || planTypeOf(order) === filter;
}
