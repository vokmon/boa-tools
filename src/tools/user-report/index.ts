#!/usr/bin/env bun
import { join } from "node:path";
import { dataDir, loadEnv } from "@/config/env";
import { DEFAULT_TIMEZONE } from "@/config/constants";
import { createWixClient } from "@/clients/wix/createWixClient";
import { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import { ContactsService } from "@/clients/wix/ContactsService";
import { createSentryClient } from "@/clients/sentry/createSentryClient";
import { ProjectsService } from "@/clients/sentry/ProjectsService";
import { MessageTimeseriesService } from "@/clients/sentry/MessageTimeseriesService";
import { LogSearchService } from "@/clients/sentry/LogSearchService";
import { buildPeriod, formatDate } from "@/lib/date";
import { writeCsv } from "@/lib/csv/CsvWriter";
import { askParsed, defineCommand, resolveOption, UsageError } from "@/lib/cli";
import { resolveDateRange, resolveSentryProjects } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { parseEmailList } from "./emails";
import { UserReport } from "./UserReport";
import { csvColumns } from "./csvColumns";
import { formatUserReport } from "./printReport";

/** Sentry keeps logs for about this long, so it is the default and the useful maximum. */
const DEFAULT_PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

defineCommand({
  name: "user-report",
  description: `
Subscription and trading performance for specific people, looked up by email: current plan and
days left, active days and last seen, orders (bot/manual), stake, win rate, profit/loss and latest
balance for real and demo, and attempts to use the app without a valid subscription.`,
  examples: [
    "bun run user-report                                  asks for emails and the rest",
    "bun run user-report --emails a@x.com,b@y.com --project all",
    "bun run user-report --file emails.txt --from 01/10/2026 --to 21/10/2026 --project bot-boa",
  ],
  options: {
    emails: { type: "string", placeholder: "list", description: "emails, separated by commas or spaces" },
    file: { type: "string", placeholder: "path", description: "file with emails (any text or CSV; every address in it is used)" },
    from: { type: "string", placeholder: "dd/mm/yyyy", description: `first day (default ${DEFAULT_PERIOD_DAYS} days ago; asked if omitted)` },
    to: { type: "string", placeholder: "dd/mm/yyyy", description: "last day, inclusive (default today; asked if omitted)" },
    project: { type: "string", placeholder: "slugs|all", description: "Sentry projects, comma separated (asked if omitted)" },
    tz: { type: "string", placeholder: "zone", description: "timezone for the days", default: DEFAULT_TIMEZONE },
    out: { type: "string", placeholder: "path", description: "CSV path (default <DATA_DIR>/reports/user-report_<from>_<to>.csv)" },
  },
  notes: `
Sentry keeps logs for about 30 days. Orders and trades only include what the app logged: trades
placed directly in IQ Option, or closing while the app was shut, are missing.`,
  run: async (values) => {
    const timeZone = values.tz;
    const env = loadEnv();

    const emails = await resolveEmails(values.emails, values.file);
    const today = formatDate(new Date(), timeZone);
    const { from, to } = await resolveDateRange({
      from: values.from,
      to: values.to,
      defaultFrom: formatDate(new Date(Date.now() - (DEFAULT_PERIOD_DAYS - 1) * DAY_MS), timeZone),
      defaultTo: today,
      fromDefaultsWithoutTerminal: true,
    });
    if (Date.now() - buildPeriod(from, from, timeZone).window.start.getTime() > (DEFAULT_PERIOD_DAYS + 1) * DAY_MS) {
      logger.warn(`Sentry keeps logs for about ${DEFAULT_PERIOD_DAYS} days; activity before that will be missing`);
    }

    const sentry = createSentryClient(env);
    const wix = createWixClient(env);
    const projects = await resolveSentryProjects(values.project, await new ProjectsService(sentry, env.SENTRY_ORG).listProjects());

    const period = buildPeriod(from, to, timeZone);
    logger.info(`${emails.length} email${emails.length === 1 ? "" : "s"}, Sentry projects: ${projects.map((p) => p.slug).join(", ")}`);

    const report = new UserReport({
      orders: new PricingPlanOrdersService(wix),
      contacts: new ContactsService(wix),
      usage: new MessageTimeseriesService(sentry, env.SENTRY_ORG),
      logs: new LogSearchService(sentry, env.SENTRY_ORG),
    });
    const rows = await report.build({ emails, period, sentryProjectIds: projects.map((p) => String(p.id)) });

    const out = values.out ?? join(dataDir(), "reports", `user-report_${period.days[0]!.key}_${period.days.at(-1)!.key}.csv`);
    await writeCsv(out, rows, csvColumns(timeZone));

    console.log(`\n${formatUserReport(rows, period)}`);
    logger.info(`CSV written to ${out}`);
  },
});

async function resolveEmails(flag: string | undefined, file: string | undefined): Promise<string[]> {
  if (flag !== undefined && file !== undefined) throw new UsageError("use --emails or --file, not both");
  if (file !== undefined) {
    const source = Bun.file(file);
    if (!(await source.exists())) throw new UsageError(`--file: ${file} does not exist`);
    return resolveOption({ flag: "--file", value: await source.text(), parse: parseEmailList, ask: async () => [] });
  }
  return resolveOption({
    flag: "--emails",
    value: flag,
    parse: parseEmailList,
    ask: () => askParsed("Emails (separate with commas or spaces):", parseEmailList),
  });
}
