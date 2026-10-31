import { planText } from "@/tools/shared/planText";
import type { FollowUpRow } from "./types";

/** "Trial (trial), ENDED 20/10/2026", "no plan in Wix" or "not in Wix". */
export function lastPlanText(r: FollowUpRow, timeZone: string): string {
  return r.inWix ? planText(r.lastPlan, timeZone) : "not in Wix";
}
