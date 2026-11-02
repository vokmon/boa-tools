import type { ContactsService } from "@/clients/wix/ContactsService";
import type { LogSearchService } from "@/clients/sentry/LogSearchService";
import { WIX_IQ_OPTION_FIELD_KEY } from "@/config/constants";
import { sumByUser, type PnlTotal } from "@/domain/trading";
import type { Period } from "@/lib/date";
import { logger } from "@/lib/logger";
import { readClosedPositions, readPlacedOrders } from "@/tools/shared/tradeLogs";
import type { DailyResultRow, DayResult } from "./types";

export interface DailyResultsDependencies {
  contacts: Pick<ContactsService, "getContactsByCustomField">;
  logs: Pick<LogSearchService, "iterateLogs">;
}

export interface DailyResultsOptions {
  period: Period;
  sentryProjectIds: string[];
}

/** Everyone who closed a trade in the period, with their Wix details and whether they won or lost. */
export class DailyResults {
  constructor(private readonly deps: DailyResultsDependencies) {}

  async build(options: DailyResultsOptions): Promise<DailyResultRow[]> {
    if (options.sentryProjectIds.length === 0) throw new Error("Select at least one Sentry project");
    const scope = { window: options.period.window, projectIds: options.sentryProjectIds };
    const [positions, orders] = await Promise.all([readClosedPositions(this.deps.logs, scope), readPlacedOrders(this.deps.logs, scope)]);
    const pnlById = sumByUser(positions, orders);
    logger.info(`Sentry: ${positions.length} closed positions by ${pnlById.size} people`);
    if (pnlById.size === 0) return [];

    const contactsById = await this.deps.contacts.getContactsByCustomField(WIX_IQ_OPTION_FIELD_KEY, pnlById.keys());
    logger.info(`Wix: ${contactsById.size} of ${pnlById.size} IQ Option ids found`);

    const rows = [...pnlById].map(([iqOptionId, pnl]): DailyResultRow => {
      const contacts = contactsById.get(iqOptionId) ?? [];
      // With several contacts, the details come from the first one that has a name.
      const main = contacts.find((c) => c.info?.name?.first || c.info?.name?.last) ?? contacts[0];
      return {
        iqOptionId,
        inWix: contacts.length > 0,
        firstName: main?.info?.name?.first ?? "",
        lastName: main?.info?.name?.last ?? "",
        email: main?.primaryInfo?.email ?? "",
        phone: main?.primaryInfo?.phone ?? "",
        pnl,
        result: resultOf(pnl),
      };
    });
    return rows.sort(compareRows);
  }
}

/** Decided by the real account only; demo money is not real. */
export function resultOf(pnl: readonly PnlTotal[]): DayResult {
  const real = pnl.filter((t) => t.account === "real");
  if (real.length === 0) return "DEMO ONLY";
  const net = realNet(pnl);
  return net > 0 ? "WIN" : net < 0 ? "LOSS" : "EVEN";
}

/** Net real profit/loss; a person trades in one currency, so summing across currencies only matters for its sign. */
function realNet(pnl: readonly PnlTotal[]): number {
  return pnl.filter((t) => t.account === "real").reduce((sum, t) => sum + t.pnl, 0);
}

/** The biggest real loss first, then the rest by real result; demo-only people last. */
function compareRows(a: DailyResultRow, b: DailyResultRow): number {
  const demoOnly = Number(a.result === "DEMO ONLY") - Number(b.result === "DEMO ONLY");
  return demoOnly || realNet(a.pnl) - realNet(b.pnl) || a.iqOptionId.localeCompare(b.iqOptionId);
}
