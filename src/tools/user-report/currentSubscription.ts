import type { SubscriptionOrder } from "@/domain/subscriptions";
import { planTypeOf } from "@/domain/subscriptions";
import type { CurrentSubscription, SubscriptionState } from "./types";

const DAY_MS = 86_400_000;

function stateOf(o: SubscriptionOrder, now: Date): SubscriptionState {
  switch (o.order.status) {
    case "ACTIVE":
      return o.end && o.end < now ? "ENDED" : "ACTIVE";
    case "PENDING":
    case "DRAFT":
      return "UPCOMING";
    case "PAUSED":
      return "PAUSED";
    case "CANCELED":
      return "CANCELED";
    default:
      return "ENDED";
  }
}

/**
 * The subscription that matters right now: an active one (latest end first), else an upcoming
 * one, else a paused one, else the one that ended most recently.
 */
export function currentSubscription(orders: SubscriptionOrder[], now = new Date()): CurrentSubscription | null {
  if (orders.length === 0) return null;
  const end = (o: SubscriptionOrder) => o.end?.getTime() ?? Infinity;
  const withState = orders.map((o) => ({ o, state: stateOf(o, now) }));
  const pick = (state: SubscriptionState, by: (a: SubscriptionOrder, b: SubscriptionOrder) => number) =>
    withState.filter((x) => x.state === state).sort((a, b) => by(a.o, b.o))[0];
  const chosen =
    pick("ACTIVE", (a, b) => end(b) - end(a)) ??
    pick("UPCOMING", (a, b) => a.start.getTime() - b.start.getTime()) ??
    pick("PAUSED", (a, b) => end(b) - end(a)) ??
    [...withState].sort((a, b) => end(b.o) - end(a.o))[0]!;

  const { o, state } = chosen;
  return {
    plan: o.order.planName ?? "",
    planType: planTypeOf(o.order),
    state,
    start: o.start,
    end: o.end,
    daysLeft: state === "ACTIVE" && o.end ? Math.max(0, Math.ceil((o.end.getTime() - now.getTime()) / DAY_MS)) : null,
    otherPlans: orders.length - 1,
  };
}
