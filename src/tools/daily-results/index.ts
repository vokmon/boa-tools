#!/usr/bin/env bun
import { join } from "node:path";
import { loadEnv, reportsDir } from "@/config/env";
import { DEFAULT_TIMEZONE } from "@/config/constants";
import { createWixClient } from "@/clients/wix/createWixClient";
import { ContactsService } from "@/clients/wix/ContactsService";
import { createSentryClient } from "@/clients/sentry/createSentryClient";
import { ProjectsService } from "@/clients/sentry/ProjectsService";
import { LogSearchService } from "@/clients/sentry/LogSearchService";
import { buildPeriod, formatDate } from "@/lib/date";
import { writeCsv } from "@/lib/csv/CsvWriter";
import { askParsed, defineCommand, resolveOption } from "@/lib/cli";
import { parseDate, resolveSentryProjects } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { DailyResults } from "./DailyResults";
import { csvColumns } from "./csvColumns";
import { formatDailyResults } from "./printReport";

defineCommand({
  name: "daily-results",
  description: `
Everyone who closed a trade on a day: name, email, phone and whether they won or lost (by the real
account), with the profit/loss real and demo apart, split by system, manual and outside the app.`,
  examples: [
    "bun run daily-results                                     today; asks for projects",
    "bun run daily-results --date 01/11/2026 --project all",
  ],
  options: {
    date: { type: "string", placeholder: "dd/mm/yyyy", description: "the day (default today; asked if omitted)" },
    project: { type: "string", placeholder: "slugs|all", description: "Sentry projects, comma separated (asked if omitted)" },
    tz: { type: "string", placeholder: "zone", description: "timezone for the day", default: DEFAULT_TIMEZONE },
    out: { type: "string", placeholder: "path", description: "CSV path (default <REPORTS_DIR>/daily-results_<date>.csv)" },
  },
  notes: `
Trades come from the app's "Position closed" logs in Sentry (about 30 days kept), counted once per
order even with several browsers open. WIN / LOSS is decided by the real account only.`,
  run: async (values) => {
    const timeZone = values.tz;
    const env = loadEnv();
    const today = formatDate(new Date(), timeZone);
    const date = await resolveOption({
      flag: "--date",
      value: values.date,
      parse: parseDate,
      ask: () => askParsed("Date (dd/mm/yyyy):", parseDate, { default: today }),
      fallback: () => today,
    });

    const sentry = createSentryClient(env);
    const projects = await resolveSentryProjects(values.project, await new ProjectsService(sentry, env.SENTRY_ORG).listProjects());
    logger.info(`Sentry projects: ${projects.map((p) => p.slug).join(", ")}`);

    const period = buildPeriod(date, date, timeZone);
    const report = new DailyResults({
      contacts: new ContactsService(createWixClient(env)),
      logs: new LogSearchService(sentry, env.SENTRY_ORG),
    });
    const rows = await report.build({ period, sentryProjectIds: projects.map((p) => String(p.id)) });

    const out = values.out ?? join(reportsDir(), `daily-results_${period.days[0]!.key}.csv`);
    await writeCsv(out, rows, csvColumns(rows));

    console.log(`\n${formatDailyResults(rows, period)}`);
    logger.info(`CSV written to ${out}`);
  },
});
