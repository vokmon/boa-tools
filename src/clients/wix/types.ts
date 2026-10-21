import type { orders } from "@wix/pricing-plans";
import type { contacts as crmContacts } from "@wix/crm";

/** Re-exported SDK types so the rest of the code does not import SDK internals. */
export type WixOrder = orders.Order;
export type WixContact = crmContacts.Contact;
