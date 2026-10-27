#!/usr/bin/env bun
import { join } from "node:path";
import { dataDir, loadEnv } from "@/config/env";
import { DEFAULT_TIMEZONE } from "@/config/constants";
import { createWixClient } from "@/clients/wix/createWixClient";
import { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import { ContactsService } from "@/clients/wix/ContactsService";
import { createSentryClient } from "@/clients/sentry/createSentryClient";
import { ProjectsService } from "@/clients/sentry/ProjectsService";
import { LogSearchService } from "@/clients/sentry/LogSearchService";
import { buildPeriod, formatDate } from "@/lib/date";
import { writeCsv } from "@/lib/csv/CsvWriter";
import { askYesNo, defineCommand, resolveFlag } from "@/lib/cli";
import { resolveDateRange, resolveSentryProjects } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { FollowUpReport } from "./FollowUpReport";
import { csvColumns } from "./csvColumns";
import { formatFollowUpReport } from "./printReport";

/** Sentry keeps logs for about this long, so it is the default and the useful maximum. */
const DEFAULT_PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

defineCommand({
  name: "follow-up-logins",
  description: `
People with a Wix account who tried to sign in to the app during the period but had no valid
subscription, and still have none: name, email, phone, attempts and their last plan. Anyone who
has subscribed since is left out.`,
  examples: [
    "bun run follow-up-logins                                  asks for dates and projects",
    "bun run follow-up-logins --from 01/10/2026 --to 27/10/2026 --project all --pnl",
  ],
  options: {
    from: { type: "string", placeholder: "dd/mm/yyyy", description: `first day (default ${DEFAULT_PERIOD_DAYS} days ago; asked if omitted)` },
    to: { type: "string", placeholder: "dd/mm/yyyy", description: "last day, inclusive (default today; asked if omitted)" },
    project: { type: "string", placeholder: "slugs|all", description: "Sentry projects, comma separated (asked if omitted)" },
    pnl: {
      type: "boolean",
      description: "sum profit/loss of each person's closed trades in the period, real and demo separately (asked if omitted)",
    },
    tz: { type: "string", placeholder: "zone", description: "timezone for the days", default: DEFAULT_TIMEZONE },
    out: { type: "string", placeholder: "path", description: "CSV path (default <DATA_DIR>/reports/follow-up-logins_<from>_<to>.csv)" },
  },
  notes: `
Sentry keeps logs for about 30 days. Attempts come from the "Subscription validation failed"
log, written when someone signs in with IQ Option and their Wix account has no active plan.`,
  run: async (values) => {
    const timeZone = values.tz;
    const env = loadEnv();

    const today = formatDate(new Date(), timeZone);
    const { from, to } = await resolveDateRange({
      from: values.from,
      to: values.to,
      defaultFrom: formatDate(new Date(Date.now() - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS), timeZone),
      defaultTo: today,
      fromDefaultsWithoutTerminal: true,
    });
    if (Date.now() - buildPeriod(from, from, timeZone).window.start.getTime() > (DEFAULT_PERIOD_DAYS + 1) * DAY_MS) {
      logger.warn(`Sentry keeps logs for about ${DEFAULT_PERIOD_DAYS} days; attempts before that will be missing`);
    }

    const includePnl = await resolveFlag({
      flag: "--pnl",
      value: values.pnl,
      ask: () => askYesNo("Include profit/loss of their closed trades?", { default: false }),
      fallback: false,
    });

    const sentry = createSentryClient(env);
    const wix = createWixClient(env);
    const projects = await resolveSentryProjects(values.project, await new ProjectsService(sentry, env.SENTRY_ORG).listProjects());

    const period = buildPeriod(from, to, timeZone);
    logger.info(`Sentry projects: ${projects.map((p) => p.slug).join(", ")}`);

    const report = new FollowUpReport({
      orders: new PricingPlanOrdersService(wix),
      contacts: new ContactsService(wix),
      logs: new LogSearchService(sentry, env.SENTRY_ORG),
    });
    const result = await report.build({ period, includePnl, sentryProjectIds: projects.map((p) => String(p.id)) });

    const out = values.out ?? join(dataDir(), "reports", `follow-up-logins_${period.days[0]!.key}_${period.days.at(-1)!.key}.csv`);
    await writeCsv(out, result.rows, csvColumns(timeZone, result.rows));

    console.log(`\n${formatFollowUpReport(result, period, includePnl)}`);
    logger.info(`CSV written to ${out}`);
  },
});
