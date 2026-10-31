import type { orders } from "@wix/pricing-plans";
import type { contacts as crmContacts } from "@wix/crm";
import type { members } from "@wix/members";
import type { participants, programs } from "@wix/online-programs";

/** Re-exported SDK types so the rest of the code does not import SDK internals. */
export type WixOrder = orders.Order;
export type WixContact = crmContacts.Contact;
export type WixMember = members.Member;
export type WixParticipant = participants.Participant;
export type WixProgram = programs.Program;
