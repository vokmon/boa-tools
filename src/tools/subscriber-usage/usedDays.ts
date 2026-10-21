import { compactDays } from "@/lib/date";
import type { SubscriberUsageRow } from "./types";

/** "18/10, 20/10" style list of the days with at least one log. */
export function usedDaysText(row: SubscriberUsageRow): string {
  return compactDays(row.days.filter((d) => d.logCount > 0).map((d) => d.day));
}
