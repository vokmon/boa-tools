import { describe, expect, test } from "bun:test";
import { MemberReport, type MemberReportDependencies } from "@/tools/member-report/MemberReport";
import { csvColumns } from "@/tools/member-report/csvColumns";
import { formatMemberReport } from "@/tools/member-report/printReport";
import type { WixContact, WixMember, WixOrder, WixParticipant } from "@/clients/wix/types";
import type { LogRow, LogSearchOptions } from "@/clients/sentry/LogSearchService";
import { buildPeriod } from "@/lib/date";
import { toCsv } from "@/lib/csv/CsvWriter";
import { resolveDateRange } from "@/tools/shared/commonOptions";

const now = new Date("2026-10-31T05:00:00Z");
const period = buildPeriod("20/10/2026", "31/10/2026", "Asia/Bangkok");

function member(id: string, lastLogin: string | null, contact: WixMember["contact"] = {}): WixMember {
  return { _id: `m-${id}`, contactId: id, loginEmail: `${id.toUpperCase()}@x.test`, lastLoginDate: lastLogin ? new Date(lastLogin) : null, contact };
}
function contact(id: string, iq?: string): WixContact {
  const items = iq === undefined ? {} : { "custom.iq-option": iq };
  return { _id: id, info: { name: { first: `C${id}`, last: `L${id}` }, extendedFields: { items } }, primaryInfo: { email: `${id}@x.test`, phone: `08-${id}` } };
}
function order(contactId: string, status: string, end: string | null, planName = "Bot 1 Month", price = "2990"): WixOrder {
  return { _id: `o-${contactId}-${status}`, buyer: { contactId }, status: status as WixOrder["status"], startDate: new Date("2026-10-01T00:00:00Z"), endDate: end ? new Date(end) : null, planPrice: price, planName };
}
function completed(memberId: string, programId: string, at: string): WixParticipant {
  return { memberId, programId, progressStatus: "COMPLETED", lastActivityDate: new Date(at) };
}

const members = [
  // Active subscriber who did two trainings; the member's own name wins over the contact's.
  member("a", "2026-10-30T14:00:00Z", { firstName: "Somchai", lastName: "Jaidee", phones: ["081"] }),
  // Expired trial, logged in more recently than a.
  member("b", "2026-10-31T01:00:00Z"),
  // Never logged in, no plan, no contact details on the member.
  member("c", null),
];
const contacts = new Map([
  ["a", contact("a", "111")],
  ["b", contact("b", "not-a-number")],
  ["c", contact("c", "333")],
]);
const orders = [order("a", "ACTIVE", "2026-11-25T16:59:59Z"), order("b", "ENDED", "2026-10-20T16:59:59Z", "Trial", "0")];
const participants = [completed("m-a", "p1", "2026-10-05T03:00:00Z"), completed("m-a", "p2", "2026-10-12T03:00:00Z"), completed("m-x", "p1", "2026-10-12T03:00:00Z")];
const programs = [{ _id: "p1", description: { title: "Bot basics" } }, { _id: "p2", description: { title: "Money management" } }];

const closedLogs: LogRow[] = [
  { message: "Position closed (85.00) - order (1) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-21T03:00:00+00:00" },
  { message: "Position closed (-20.00) - order (2) - user_iq: 111", balance: '{"type":"real","currency":"THB"}', timestamp: "2026-10-22T03:00:00+00:00" },
];
const orderLogs: LogRow[] = [{ message: "Order placed successfully (system) (1) 1/A - Amount: 100.00 - user_iq: 111", order: "{}", timestamp: "2026-10-21T02:59:00+00:00" }];

const searches: LogSearchOptions[] = [];
function deps(trainingsFail = false): MemberReportDependencies {
  return {
    members: { listMembers: async () => members },
    contacts: { getContactsByIds: async (ids) => new Map([...ids].flatMap((id): [string, WixContact][] => (contacts.has(id) ? [[id, contacts.get(id)!]] : []))) },
    orders: { listOrders: async () => orders },
    programs: {
      listCompletedParticipants: async () => {
        if (trainingsFail) throw new Error("PERMISSION_DENIED");
        return participants;
      },
      listPrograms: async () => programs,
    },
    logs: {
      iterateLogs: async function* (o: LogSearchOptions) {
        searches.push(o);
        if (o.query.includes("Position closed")) yield* closedLogs;
        else if (o.query.includes("Order placed")) yield* orderLogs;
      },
    },
  };
}

describe("MemberReport", () => {
  test("every member, active subscriptions first, then by latest login", async () => {
    const { rows, trainingsRead } = await new MemberReport(deps()).build({ now });
    expect(trainingsRead).toBe(true);
    expect(rows.map((r) => r.email)).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
  });

  test("details, last training and plan", async () => {
    const [a, b, c] = (await new MemberReport(deps()).build({ now })).rows;
    expect(a).toMatchObject({ firstName: "Somchai", lastName: "Jaidee", phone: "081", iqOptionId: "111", subscriptionActive: true, trainingsCompleted: 2 });
    expect(a!.lastTraining).toEqual({ program: "Money management", completedAt: new Date("2026-10-12T03:00:00Z") });
    expect(a!.plan).toMatchObject({ plan: "Bot 1 Month", state: "ACTIVE" });
    // Falls back to the contact; an invalid IQ Option id is left empty.
    expect(b).toMatchObject({ firstName: "Cb", phone: "08-b", iqOptionId: "", subscriptionActive: false, trainingsCompleted: 0, lastTraining: null });
    expect(b!.plan).toMatchObject({ plan: "Trial", planType: "trial", state: "ENDED" });
    expect(c).toMatchObject({ lastLogin: null, plan: null, subscriptionActive: false });
  });

  test("without the Online Programs permission the report still runs, training left blank", async () => {
    const { rows, trainingsRead } = await new MemberReport(deps(true)).build({ now });
    expect(trainingsRead).toBe(false);
    expect(rows[0]).toMatchObject({ lastTraining: null, trainingsCompleted: null });
  });

  test("profit/loss reads every trade log once, only when requested", async () => {
    searches.length = 0;
    expect((await new MemberReport(deps()).build({ now })).rows[0]!.pnl).toBeNull();
    expect(searches).toHaveLength(0);

    const rows = (await new MemberReport(deps()).build({ now, pnl: { period, sentryProjectIds: ["1"] } })).rows;
    expect(searches).toHaveLength(2);
    expect(searches.every((s) => !s.query.includes("111"))).toBe(true);
    expect(rows[0]!.pnl).toMatchObject([{ account: "real", currency: "THB", trades: 2, pnl: 65, bySource: { system: { pnl: 85 }, outside: { pnl: -20 } } }]);
    // No valid id: nothing to match. A valid id without trades: zero.
    expect(rows[1]!.pnl).toBeNull();
    expect(rows[2]!.pnl).toEqual([]);
  });
});

describe("output", () => {
  test("CSV columns", async () => {
    const { rows } = await new MemberReport(deps()).build({ now });
    const [header, first] = toCsv(rows, csvColumns("Asia/Bangkok", rows)).split("\r\n");
    expect(header).toBe(
      "first_name,last_name,email,phone,last_login,last_training_completed,training_completed_at,trainings_completed,last_plan,plan_type,plan_status,plan_end,subscription_active,iq_option_id",
    );
    expect(first).toBe("Somchai,Jaidee,a@x.test,081,30/10/2026 21:00,Money management,12/10/2026,2,Bot 1 Month,paid,ACTIVE,25/11/2026,yes,111");
  });

  test("terminal summary", async () => {
    const text = formatMemberReport(await new MemberReport(deps()).build({ now }), "Asia/Bangkok");
    expect(text).toContain("3 members: 1 with an active subscription, 2 without; 1 completed a training.");
    expect(text).toContain("Money management 12/10/2026 (+1)");
    expect(text).toContain("never logged in");
  });
});

describe("resolveDateRange with allFrom", () => {
  const base = { defaultFrom: "01/08/2026", defaultTo: "31/10/2026", allFrom: "01/08/2026" };

  test("--from all starts at allFrom", async () => {
    expect(await resolveDateRange({ ...base, from: "all", to: "31/10/2026" })).toEqual({ from: "01/08/2026", to: "31/10/2026", all: true });
  });

  test("a date is used as given", async () => {
    expect(await resolveDateRange({ ...base, from: "1/10/2026", to: "31/10/2026" })).toEqual({ from: "01/10/2026", to: "31/10/2026", all: false });
  });

  test("without allFrom, all is not a date", async () => {
    const { allFrom: _, ...plain } = base;
    await expect(resolveDateRange({ ...plain, from: "all", to: "31/10/2026" })).rejects.toThrow("--from");
  });
});
