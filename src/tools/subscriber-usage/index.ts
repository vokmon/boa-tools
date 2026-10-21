#!/usr/bin/env bun
import { join } from "node:path";
import { loadEnv } from "@/config/env";
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
import { askYesNo, chooseOne, defineCommand, resolveFlag, resolveOption } from "@/lib/cli";
import { resolveDateRange, resolveSentryProjects } from "@/tools/shared/commonOptions";
import { logger } from "@/lib/logger";
import { SubscriberUsageReport } from "./SubscriberUsageReport";
import { csvColumns } from "./csvColumns";
import { formatReport } from "./printReport";
import { SUBSCRIPTION_MATCHES, type PlanFilter, type SubscriptionMatch } from "./types";

const PLAN_FILTERS: readonly PlanFilter[] = ["trial", "paid", "all"];

function parsePlan(raw: string): PlanFilter {
  if (!PLAN_FILTERS.includes(raw as PlanFilter)) throw new Error(`must be one of ${PLAN_FILTERS.join(", ")}`);
  return raw as PlanFilter;
}

function parseMatch(raw: string): SubscriptionMatch {
  if (!SUBSCRIPTION_MATCHES.includes(raw as SubscriptionMatch)) throw new Error(`must be one of ${SUBSCRIPTION_MATCHES.join(", ")}`);
  return raw as SubscriptionMatch;
}

defineCommand({
  name: "subscriber-usage",
  description: `
Every Wix subscriber in a period and the days they used the app (production Sentry logs that
mention their IQ Option id). Lists who never used it first, then who used it most.`,
  examples: [
    "bun run subscriber-usage                      asks for anything not given",
    "bun run subscriber-usage --from 18/10/2026 --to 20/10/2026 --plan trial --match started --project all --pnl",
  ],
  options: {
    from: { type: "string", placeholder: "dd/mm/yyyy", description: "first day of the period (asked if omitted)" },
    to: { type: "string", placeholder: "dd/mm/yyyy", description: "last day of the period, inclusive (default today; asked if omitted)" },
    plan: { type: "string", placeholder: "trial|paid|all", description: "which subscriptions (asked if omitted)" },
    match: {
      type: "string",
      placeholder: "active|started",
      description: "active: subscription covers part of the period; started: it started in the period (asked if omitted)",
    },
    project: { type: "string", placeholder: "slugs|all", description: "Sentry projects, comma separated (asked if omitted)" },
    tz: { type: "string", placeholder: "zone", description: "timezone for the days", default: DEFAULT_TIMEZONE },
    pnl: {
      type: "boolean",
      description: "sum profit/loss of closed trades, real and demo separately (asked if omitted; slower)",
    },
    out: { type: "string", placeholder: "path", description: "CSV path (default data/reports/subscriber-usage_<from>_<to>_<plan>_<match>.csv)" },
  },
  notes: `
Sentry keeps logs for about 30 days. Only trading events log the IQ Option id, so someone who
opened the app without trading can show as NEVER_USED.`,
  run: async (values) => {
  const timeZone = values.tz;
    const env = loadEnv();

    const { from, to } = await resolveDateRange({
      from: values.from,
      to: values.to,
      defaultFrom: formatDate(new Date(), timeZone),
      defaultTo: formatDate(new Date(), timeZone),
    });
    const planFilter = await resolveOption({
      flag: "--plan",
      value: values.plan,
      parse: parsePlan,
      ask: () =>
        chooseOne<PlanFilter>(
          "Which subscriptions?",
          [
            { name: "Trial", value: "trial", description: "free plans (price 0)" },
            { name: "Paid", value: "paid" },
            { name: "All", value: "all" },
          ],
          { default: "trial" },
        ),
    });

    const match = await resolveOption({
      flag: "--match",
      value: values.match,
      parse: parseMatch,
      ask: () =>
        chooseOne<SubscriptionMatch>(
          "Which subscriptions count for the period?",
          [
            { name: "Active in the period", value: "active", description: "covers at least part of the period" },
            { name: "Started in the period", value: "started", description: "start date falls inside the period" },
          ],
          { default: "active" },
        ),
    });

    const includePnl = await resolveFlag({
      flag: "--pnl",
      value: values.pnl,
      ask: () => askYesNo("Include profit/loss? (reads every closed trade, slower)", { default: false }),
      fallback: false,
    });

    const sentry = createSentryClient(env);
    const wix = createWixClient(env);
    const projects = await resolveSentryProjects(values.project, await new ProjectsService(sentry, env.SENTRY_ORG).listProjects());

    const period = buildPeriod(from, to, timeZone);
    logger.info(`Plan: ${planFilter}, match: ${match}, Sentry projects: ${projects.map((p) => p.slug).join(", ")}`);

    const report = new SubscriberUsageReport({
      orders: new PricingPlanOrdersService(wix),
      contacts: new ContactsService(wix),
      usage: new MessageTimeseriesService(sentry, env.SENTRY_ORG),
      logs: new LogSearchService(sentry, env.SENTRY_ORG),
    });
    const rows = await report.build({
      period,
      planFilter,
      match,
      includePnl,
      sentryProjectIds: projects.map((p) => String(p.id)),
    });

    const out =
      values.out ??
      join("data", "reports", `subscriber-usage_${period.days[0]!.key}_${period.days.at(-1)!.key}_${planFilter}_${match}.csv`);
    await writeCsv(out, rows, csvColumns(period, rows));

    console.log(`\n${formatReport(rows, { period, planFilter, match, includePnl })}`);
    logger.info(`CSV written to ${out}`);
  },
});
