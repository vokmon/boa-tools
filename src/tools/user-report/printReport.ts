import { formatDate, formatDateTime, type Period } from "@/lib/date";
import { accountText, displayName, sourcesText, subscriptionText } from "./format";
import type { UserReportRow } from "./types";

const LABEL_WIDTH = 16;
const line = (label: string, value: string) => `  ${label.padEnd(LABEL_WIDTH)}${value}`;

/** One block per person, in the order the emails were given. */
export function formatUserReport(rows: UserReportRow[], period: Period): string {
  const tz = period.timeZone;
  const header = `User report, ${period.days[0]!.label} to ${period.days.at(-1)!.label} (${tz})`;
  return [header, "", ...rows.flatMap((r) => [...block(r, tz), ""])].join("\n");
}

function block(r: UserReportRow, tz: string): string[] {
  const id =
    r.iqOptionIdSource === "none" ? "IQ -" : `IQ ${r.iqOptionId}${r.iqOptionIdSource === "sentry" ? " (found in Sentry logs)" : ""}`;
  const lines = [[r.email, displayName(r), id, r.phone || "-"].join("   ")];

  if (r.wixMatch === "NOT_IN_WIX") lines.push(line("Wix", "no contact with this email"));
  if (r.wixMatch === "MULTIPLE_CONTACTS") lines.push(line("Wix", `${r.contactCount} contacts share this email; details from the most recent`));
  if (r.iqOptionIdNote) lines.push(line("IQ Option id", r.iqOptionIdNote));

  if (r.wixMatch !== "NOT_IN_WIX") lines.push(line("Subscription", subscriptionText(r.subscription, tz)));
  const seen = r.lastSeen ? `, last seen ${formatDateTime(r.lastSeen, tz)}` : ", not seen in the period";
  lines.push(line("Activity", `active ${r.activeDays} of ${r.periodDays} days${seen}`));

  if (r.accounts.length === 0) lines.push(line("Trading", r.iqOptionId ? "no orders or closed trades in the period" : "unknown without an IQ Option id"));
  for (const a of r.accounts) {
    lines.push(line(`${capitalize(a.account)} (${a.currency})`, accountText(a)));
    if (a.closed) lines.push(line("", `by source: ${sourcesText(a)}`));
  }

  if (r.validationFailures) {
    const last = r.lastValidationFailure ? `, last ${formatDate(r.lastValidationFailure, tz)}` : "";
    lines.push(line("Blocked", `${r.validationFailures} attempt${r.validationFailures === 1 ? "" : "s"} without a valid subscription${last}`));
  }
  return lines;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
