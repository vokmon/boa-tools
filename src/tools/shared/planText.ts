import type { CurrentSubscription } from "@/domain/currentSubscription";
import { formatDate } from "@/lib/date";

/** "Trial (trial), ENDED 20/10/2026", "Bot 1 Month (paid), UPCOMING starts 01/11/2026" or "no plan in Wix". */
export function planText(p: CurrentSubscription | null, timeZone: string): string {
  if (!p) return "no plan in Wix";
  const when = p.state === "UPCOMING" ? `starts ${formatDate(p.start, timeZone)}` : p.end ? formatDate(p.end, timeZone) : "no end date";
  return `${p.plan || "?"} (${p.planType}), ${p.state} ${when}`;
}
