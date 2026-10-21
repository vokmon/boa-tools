import type { WixContact, WixOrder } from "@/clients/wix/types";
import { ContactsService } from "@/clients/wix/ContactsService";
import { WIX_IQ_OPTION_FIELD_KEY } from "@/config/constants";

export type PlanType = "trial" | "paid";

/** A free plan (price 0) is a trial; anything with a price is paid. */
export function planTypeOf(order: WixOrder): PlanType {
  const raw = order.planPrice ?? order.pricing?.prices?.[0]?.price?.total;
  const price = raw === undefined || raw === null ? NaN : Number(raw);
  return Number.isFinite(price) && price === 0 ? "trial" : "paid";
}

/** An order with the fields the tools rely on checked and parsed. */
export interface SubscriptionOrder {
  order: WixOrder;
  contactId: string;
  start: Date;
  end: Date | null;
}

export function toSubscriptionOrder(order: WixOrder): SubscriptionOrder | null {
  const contactId = order.buyer?.contactId;
  if (!contactId || !order.startDate) return null;
  return { order, contactId, start: new Date(order.startDate), end: order.endDate ? new Date(order.endDate) : null };
}

const IQ_OPTION_ID = /^\d+$/;

export type IqOptionIdStatus = "OK" | "MISSING" | "INVALID";

/** The IQ Option id from the contact's custom field, and whether it can be searched. */
export function iqOptionIdOf(contact: WixContact): { value: string; status: IqOptionIdStatus } {
  const value = ContactsService.getCustomField(contact, WIX_IQ_OPTION_FIELD_KEY) ?? "";
  if (!value) return { value, status: "MISSING" };
  return { value, status: IQ_OPTION_ID.test(value) ? "OK" : "INVALID" };
}

export function isValidIqOptionId(value: string): boolean {
  return IQ_OPTION_ID.test(value);
}
