import { formatDate } from "@/lib/date";
import type { FollowUpRow } from "./types";

/** "Trial (trial), ENDED 20/10/2026", "no plan in Wix" or "not in Wix". */
export function lastPlanText(r: FollowUpRow, timeZone: string): string {
  if (!r.inWix) return "not in Wix";
  const p = r.lastPlan;
  if (!p) return "no plan in Wix";
  const when = p.state === "UPCOMING" ? `starts ${formatDate(p.start, timeZone)}` : p.end ? formatDate(p.end, timeZone) : "no end date";
  return `${p.plan || "?"} (${p.planType}), ${p.state} ${when}`;
}
