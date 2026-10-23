import type { RawCandle, UnderlyingInfo } from "@/clients/iqoption/types";
import { isWriteBlocked, type CandleDb, type DayStatus, type StoredAsset } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";

const dayKey = (activeId: number, day: string) => `${activeId}|${day}`;

/**
 * Where the collector saves candles from IQ Option during a backtest: the local copy first, then
 * Turso. Once Turso refuses writes (its monthly limit), the rest of the run saves to the local copy
 * only, and backfillTurso copies those days to Turso on a later run.
 */
export class MirroredStore {
  /** Set when Turso refused a write; nothing more is sent to it in this run. */
  tursoBlocked = false;
  /** Asset-days saved to the local copy only, because Turso refused writes. */
  localOnly = 0;
  private tursoComplete = new Set<string>();

  constructor(
    private readonly turso: Pick<CandleDb, "upsertAssets" | "listAssets" | "completeDays" | "saveDay">,
    private readonly local: Pick<LocalCandleCache, "replaceAssets" | "assets" | "dayVersions" | "replaceDays">,
  ) {}

  async upsertAssets(assets: readonly UnderlyingInfo[], seenAt: Date): Promise<void> {
    this.local.replaceAssets(assets);
    await this.toTurso(() => this.turso.upsertAssets(assets, seenAt));
  }

  /** Turso's assets, plus any the local copy has that Turso could not store (it refused writes). */
  async listAssets(): Promise<StoredAsset[]> {
    const assets = await this.turso.listAssets();
    const known = new Set(assets.map((a) => a.activeId));
    const localOnly = this.local.assets().filter((a) => !known.has(a.activeId)).map((a) => ({ ...a, precision: null, firstSeen: "", lastSeen: "" }));
    return [...assets, ...localOnly];
  }

  /**
   * Days complete in either place are not fetched again: a day only Turso has is copied to the local
   * copy by CandleSync, a day only the local copy has goes to Turso with backfillTurso.
   */
  async completeDays(size: number): Promise<Set<string>> {
    this.tursoComplete = await this.turso.completeDays(size);
    return new Set([...this.tursoComplete, ...this.local.dayVersions(size).keys()]);
  }

  async saveDay(input: { activeId: number; size: number; day: string; status: DayStatus; candles: readonly RawCandle[]; collectedAt: Date; replace?: boolean }): Promise<void> {
    const { activeId, size, day } = input;
    // The local copy only holds complete days (the backtest uses complete days only)
    if (input.status === "complete") {
      this.local.replaceDays(activeId, size, [{ activeId, day, candleCount: input.candles.length, collectedAt: input.collectedAt.toISOString() }], input.candles);
    }
    if (input.status === "complete" && this.tursoComplete.has(dayKey(activeId, day))) return;
    const saved = await this.toTurso(() => this.turso.saveDay(input));
    if (!saved && input.status === "complete") this.localOnly++;
  }

  /** Runs a Turso write unless Turso is blocked; true when it was written. */
  private async toTurso(write: () => Promise<void>): Promise<boolean> {
    if (this.tursoBlocked) return false;
    try {
      await write();
      return true;
    } catch (error) {
      if (!isWriteBlocked(error)) throw error;
      this.tursoBlocked = true;
      return false;
    }
  }
}
