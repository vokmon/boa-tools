import { retry } from "@/lib/retry";
import type { WixClient } from "./createWixClient";
import type { WixMember } from "./types";

const PAGE_SIZE = 100;

/** Wix site members (people with a login on the site). */
export class MembersService {
  constructor(private readonly wix: Pick<WixClient, "members">) {}

  async *iterateMembers(): AsyncGenerator<WixMember> {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await retry(
        () => this.wix.members.listMembers({ paging: { limit: PAGE_SIZE, offset }, fieldsets: ["FULL"] }),
        { label: "Wix list members" },
      );
      const items = page.members ?? [];
      yield* items;
      const total = page.metadata?.total ?? 0;
      if (items.length === 0 || offset + items.length >= total) return;
    }
  }

  async listMembers(): Promise<WixMember[]> {
    return Array.fromAsync(this.iterateMembers());
  }
}
