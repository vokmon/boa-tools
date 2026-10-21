import type { Actives, DigitalOptions } from "@quadcode-tech/client-sdk-js";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { UnderlyingInfo } from "./types";

const HOUR_MS = 3_600_000;
/** Main markets close at weekends, so look a full week ahead to see every scheduled asset. */
const LOOKAHEAD_HOURS = 24 * 7;

export class UnderlyingsService {
  constructor(
    private readonly digital: Pick<DigitalOptions, "getUnderlyingsAvailableForTradingAt">,
    private readonly actives: Pick<Actives, "getActive">,
  ) {}

  /**
   * Every digital-options underlying tradable at some hour in the next week. The SDK only answers
   * "tradable at time X", so assets removed from the broker cannot be found this way.
   */
  async listScheduled(now: Date): Promise<UnderlyingInfo[]> {
    const names = new Map<number, string>();
    for (let h = 0; h <= LOOKAHEAD_HOURS; h++) {
      for (const u of this.digital.getUnderlyingsAvailableForTradingAt(new Date(now.getTime() + h * HOUR_MS))) {
        names.set(u.activeId, u.name);
      }
    }
    const ids = [...names.keys()].sort((a, b) => a - b);
    return mapWithConcurrency(ids, 10, async (activeId) => {
      const name = names.get(activeId)!;
      const active = await this.actives.getActive(activeId).catch(() => undefined);
      return {
        activeId,
        name,
        isOtc: active?.isOtc ?? name.toLowerCase().includes("-otc"),
        precision: active?.precision ?? null,
      };
    });
  }
}
