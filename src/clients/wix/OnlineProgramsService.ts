import { retry } from "@/lib/retry";
import type { WixClient } from "./createWixClient";
import type { WixParticipant, WixProgram } from "./types";

const PAGE_SIZE = 100;

/** Wix Online Programs: the site's trainings and who took them. */
export class OnlineProgramsService {
  constructor(private readonly wix: Pick<WixClient, "participants" | "programs">) {}

  /** Every participation that finished its program, across all programs. */
  async listCompletedParticipants(): Promise<WixParticipant[]> {
    const items: WixParticipant[] = [];
    let page = await retry(
      () => this.wix.participants.queryParticipants().eq("progressStatus", "COMPLETED").limit(PAGE_SIZE).find(),
      { label: "Wix query participants" },
    );
    items.push(...page.items);
    while (page.hasNext()) {
      const current = page;
      page = await retry(() => current.next(), { label: "Wix query participants" });
      items.push(...page.items);
    }
    return items;
  }

  async listPrograms(): Promise<WixProgram[]> {
    const items: WixProgram[] = [];
    let page = await retry(() => this.wix.programs.queryPrograms().limit(PAGE_SIZE).find(), { label: "Wix query programs" });
    items.push(...page.items);
    while (page.hasNext()) {
      const current = page;
      page = await retry(() => current.next(), { label: "Wix query programs" });
      items.push(...page.items);
    }
    return items;
  }
}
