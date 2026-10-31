import type { ContactsService } from "@/clients/wix/ContactsService";
import type { MembersService } from "@/clients/wix/MembersService";
import type { OnlineProgramsService } from "@/clients/wix/OnlineProgramsService";
import type { PricingPlanOrdersService } from "@/clients/wix/PricingPlanOrdersService";
import type { LogSearchService } from "@/clients/sentry/LogSearchService";
import type { WixContact, WixMember } from "@/clients/wix/types";
import { currentSubscription, hasValidSubscription } from "@/domain/currentSubscription";
import { iqOptionIdOf, toSubscriptionOrder } from "@/domain/subscriptions";
import { sumByUser } from "@/domain/trading";
import { groupBy } from "@/lib/collections";
import type { Period } from "@/lib/date";
import { logger } from "@/lib/logger";
import { readClosedPositions, readPlacedOrders } from "@/tools/shared/tradeLogs";
import type { CompletedTraining, MemberReportResult, MemberRow } from "./types";

export interface MemberReportDependencies {
  members: Pick<MembersService, "listMembers">;
  contacts: Pick<ContactsService, "getContactsByIds">;
  orders: Pick<PricingPlanOrdersService, "listOrders">;
  programs: Pick<OnlineProgramsService, "listCompletedParticipants" | "listPrograms">;
  logs: Pick<LogSearchService, "iterateLogs">;
}

export interface MemberReportOptions {
  /** Sum profit/loss of each member's closed trades in this period; left out when omitted. */
  pnl?: { period: Period; sentryProjectIds: string[] };
  now?: Date;
}

interface Trainings {
  last: CompletedTraining;
  count: number;
}

/** Every Wix site member with their last login, last completed training, plan and (optionally) trade results. */
export class MemberReport {
  constructor(private readonly deps: MemberReportDependencies) {}

  async build(options: MemberReportOptions = {}): Promise<MemberReportResult> {
    const members = await this.deps.members.listMembers();
    logger.info(`Wix: ${members.length} members`);
    const contacts = await this.deps.contacts.getContactsByIds(members.flatMap((m) => m.contactId ?? []));
    const orders = (await this.deps.orders.listOrders()).flatMap((o) => toSubscriptionOrder(o) ?? []);
    const ordersByContact = groupBy(orders, (o) => o.contactId);
    const trainings = await this.trainings();

    const now = options.now ?? new Date();
    const rows = members.map((m): MemberRow => {
      const contact = m.contactId ? contacts.get(m.contactId) : undefined;
      const memberOrders = m.contactId ? (ordersByContact.get(m.contactId) ?? []) : [];
      const training = trainings && m._id ? trainings.get(m._id) : undefined;
      return {
        ...details(m, contact),
        lastLogin: m.lastLoginDate ? new Date(m.lastLoginDate) : null,
        iqOptionId: contact && iqOptionIdOf(contact).status === "OK" ? iqOptionIdOf(contact).value : "",
        lastTraining: training?.last ?? null,
        trainingsCompleted: trainings ? (training?.count ?? 0) : null,
        plan: currentSubscription(memberOrders, now),
        subscriptionActive: hasValidSubscription(memberOrders, now),
        pnl: null,
      };
    });
    rows.sort(compareRows);
    if (options.pnl) await this.addProfitAndLoss(rows, options.pnl);
    return { rows, trainingsRead: trainings !== null };
  }

  /** Completed online programs per member id; null when Wix refuses (the API key lacks the permission). */
  private async trainings(): Promise<Map<string, Trainings> | null> {
    let participants, programs;
    try {
      [participants, programs] = await Promise.all([this.deps.programs.listCompletedParticipants(), this.deps.programs.listPrograms()]);
    } catch (error) {
      logger.warn(`Wix: could not read online programs, training columns are left blank (${errorCode(error)})`);
      logger.warn("Wix: give the API key the Online Programs read permission to fill them");
      return null;
    }
    const titles = new Map(programs.map((p) => [p._id ?? "", p.description?.title ?? ""]));
    const byMember = new Map<string, Trainings>();
    for (const p of participants) {
      if (!p.memberId) continue;
      const completedAt = p.lastActivityDate ? new Date(p.lastActivityDate) : null;
      const training = { program: titles.get(p.programId ?? "") || "?", completedAt };
      const t = byMember.get(p.memberId);
      if (!t) byMember.set(p.memberId, { last: training, count: 1 });
      else {
        t.count++;
        if ((completedAt?.getTime() ?? 0) > (t.last.completedAt?.getTime() ?? 0)) t.last = training;
      }
    }
    logger.info(`Wix: ${participants.length} completed trainings by ${byMember.size} members`);
    return byMember;
  }

  /** Reads every trade log in the period once: with hundreds of members that beats a search per person. */
  private async addProfitAndLoss(rows: MemberRow[], { period, sentryProjectIds }: NonNullable<MemberReportOptions["pnl"]>): Promise<void> {
    if (sentryProjectIds.length === 0) throw new Error("Select at least one Sentry project");
    const scope = { window: period.window, projectIds: sentryProjectIds };
    const [positions, orders] = await Promise.all([readClosedPositions(this.deps.logs, scope), readPlacedOrders(this.deps.logs, scope)]);
    logger.info(`Sentry: ${positions.length} closed positions and ${orders.length} placed orders read`);
    const pnlById = sumByUser(positions, orders);
    for (const r of rows) if (r.iqOptionId) r.pnl = pnlById.get(r.iqOptionId) ?? [];
  }
}

/** Name and phone from the member's own contact details, falling back to the CRM contact. */
function details(m: WixMember, contact: WixContact | undefined): Pick<MemberRow, "email" | "firstName" | "lastName" | "phone"> {
  return {
    email: (m.loginEmail ?? contact?.primaryInfo?.email ?? "").toLowerCase(),
    firstName: m.contact?.firstName || contact?.info?.name?.first || "",
    lastName: m.contact?.lastName || contact?.info?.name?.last || "",
    phone: m.contact?.phones?.[0] || contact?.primaryInfo?.phone || "",
  };
}

/** Wix SDK errors carry the reason in `details.applicationError.code` (e.g. PERMISSION_DENIED). */
function errorCode(error: unknown): string {
  const e = error as { details?: { applicationError?: { code?: string } }; message?: string };
  return e?.details?.applicationError?.code ?? e?.message ?? String(error);
}

/** Active subscriptions first, then the latest login; never logged in last. */
function compareRows(a: MemberRow, b: MemberRow): number {
  return (
    Number(b.subscriptionActive) - Number(a.subscriptionActive) ||
    (b.lastLogin?.getTime() ?? 0) - (a.lastLogin?.getTime() ?? 0) ||
    a.email.localeCompare(b.email)
  );
}
