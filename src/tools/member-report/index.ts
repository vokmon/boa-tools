#!/usr/bin/env bun
import { join } from "node:path";
import { dataDir, loadEnv } from "@/config/env";
import { DEFAULT_TIMEZONE } from "@/config/constants";
import { createWixClient } from "@/clients/wix/createWixClient";
import { ContactsService } from "@/clients/wix/ContactsService";
import { MembersService } from "@/clients/wix/MembersService";
import { OnlineProgramsService } from "@/clients/wix/OnlineProgramsService";
import { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import { createSentryClient } from "@/clients/sentry/createSentryClient";
import { ProjectsService } from "@/clients/sentry/ProjectsService";
import { LogSearchService } from "@/clients/sentry/LogSearchService";
import { buildPeriod, formatDate, type Period } from "@/lib/date";
import { writeCsv } from "@/lib/csv/CsvWriter";
import { askYesNo, defineCommand, resolveFlag } from "@/lib/cli";
import { resolveDateRange, resolveSentryProjects } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { MemberReport } from "./MemberReport";
import { csvColumns } from "./csvColumns";
import { formatMemberReport } from "./printReport";

/** Sentry keeps logs for about 30 days; an empty From searches from this far back to get all of them. */
const ALL_TRADES_DAYS = 90;
const DAY_MS = 86_400_000;

defineCommand({
  name: "member-report",
  description: `
Every Wix site member: name, email, phone, last login, last completed online training and their
plan (active or not). With --pnl, also the profit/loss of their closed trades in a period.`,
  examples: [
    "bun run member-report                                     asks whether to include P/L",
    "bun run member-report --no-pnl",
    "bun run member-report --pnl --from all --project all       all trades Sentry still keeps",
    "bun run member-report --pnl --from 01/10/2026 --to 31/10/2026 --project all",
  ],
  options: {
    pnl: {
      type: "boolean",
      description: "sum profit/loss of each member's closed trades in the period, real and demo separately (asked if omitted)",
    },
    from: { type: "string", placeholder: "dd/mm/yyyy", description: "first day for trades, with --pnl, or all (default all: whatever Sentry still keeps; asked if omitted)" },
    to: { type: "string", placeholder: "dd/mm/yyyy", description: "last day for trades, inclusive, with --pnl (default today; asked if omitted)" },
    project: { type: "string", placeholder: "slugs|all", description: "Sentry projects, comma separated, with --pnl (asked if omitted)" },
    tz: { type: "string", placeholder: "zone", description: "timezone for dates", default: DEFAULT_TIMEZONE },
    out: { type: "string", placeholder: "path", description: "CSV path (default <DATA_DIR>/reports/member-report_<date>.csv)" },
  },
  notes: `
Site collaborators (admins) cannot be told apart through the Wix API, so they are listed too.
Trainings come from Wix Online Programs; the API key needs that read permission, otherwise the
training columns are left blank. Sentry keeps logs for about 30 days.`,
  run: async (values) => {
    const timeZone = values.tz;
    const env = loadEnv();
    const today = formatDate(new Date(), timeZone);

    const includePnl = await resolveFlag({
      flag: "--pnl",
      value: values.pnl,
      ask: () => askYesNo("Include profit/loss of their closed trades? (reads every closed trade, slower)", { default: false }),
      fallback: false,
    });

    const wix = createWixClient(env);
    const sentry = createSentryClient(env);
    let pnl: { period: Period; all: boolean; sentryProjectIds: string[] } | undefined;
    if (includePnl) {
      const allFrom = formatDate(new Date(Date.now() - (ALL_TRADES_DAYS - 1) * DAY_MS), timeZone);
      const { from, to, all } = await resolveDateRange({ from: values.from, to: values.to, defaultFrom: allFrom, defaultTo: today, allFrom });
      const projects = await resolveSentryProjects(values.project, await new ProjectsService(sentry, env.SENTRY_ORG).listProjects());
      logger.info(`Sentry projects: ${projects.map((p) => p.slug).join(", ")}`);
      pnl = { period: buildPeriod(from, to, timeZone), all, sentryProjectIds: projects.map((p) => String(p.id)) };
    }

    const report = new MemberReport({
      members: new MembersService(wix),
      contacts: new ContactsService(wix),
      orders: new PricingPlanOrdersService(wix),
      programs: new OnlineProgramsService(wix),
      logs: new LogSearchService(sentry, env.SENTRY_ORG),
    });
    const result = await report.build({ pnl });

    const suffix = pnl ? `${pnl.all ? "all" : pnl.period.days[0]!.key}_${pnl.period.days.at(-1)!.key}` : buildPeriod(today, today, timeZone).days[0]!.key;
    const out = values.out ?? join(dataDir(), "reports", `member-report_${suffix}.csv`);
    await writeCsv(out, result.rows, csvColumns(timeZone, result.rows));

    console.log(`\n${formatMemberReport(result, timeZone, pnl ?? null)}`);
    logger.info(`CSV written to ${out}`);
  },
});
