import { chunk, uniq } from "@/lib/collections";
import { retry } from "@/lib/retry";
import type { WixClient } from "./createWixClient";
import type { WixContact } from "./types";

/** Wix query filters accept at most 100 values in an `in` condition. */
const MAX_IDS_PER_QUERY = 100;

export class ContactsService {
  constructor(private readonly wix: Pick<WixClient, "contacts">) {}

  /** Returns found contacts keyed by id. Deleted contacts are simply absent. */
  async getContactsByIds(ids: Iterable<string>): Promise<Map<string, WixContact>> {
    const result = new Map<string, WixContact>();
    for (const batch of chunk(uniq(ids), MAX_IDS_PER_QUERY)) {
      const page = await retry(
        () => this.wix.contacts.queryContacts().in("_id", batch).limit(MAX_IDS_PER_QUERY).find(),
        { label: "Wix query contacts" },
      );
      for (const contact of page.items) if (contact._id) result.set(contact._id, contact);
    }
    return result;
  }

  /** Contacts per lower-cased email (primary email). An email can match several contacts or none. */
  async getContactsByEmails(emails: Iterable<string>): Promise<Map<string, WixContact[]>> {
    const result = new Map<string, WixContact[]>();
    for (const batch of chunk(uniq([...emails].map((e) => e.toLowerCase())), MAX_IDS_PER_QUERY)) {
      const page = await retry(
        () => this.wix.contacts.queryContacts().in("primaryInfo.email", batch).limit(MAX_IDS_PER_QUERY).find(),
        { label: "Wix query contacts by email" },
      );
      for (const contact of page.items) {
        const email = contact.primaryInfo?.email?.toLowerCase();
        if (!email) continue;
        result.set(email, [...(result.get(email) ?? []), contact]);
      }
    }
    return result;
  }

  static getCustomField(contact: WixContact, key: string): string | undefined {
    const value = contact.info?.extendedFields?.items?.[key];
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text === "" ? undefined : text;
  }
}
