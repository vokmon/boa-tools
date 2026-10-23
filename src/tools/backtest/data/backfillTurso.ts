import { isWriteBlocked, type CandleDb } from "@/storage/CandleDb";
import type { LocalCandleCache } from "@/storage/LocalCandleCache";
import { mapWithConcurrency } from "@/lib/concurrency";

const DAY_S = 86_400;
const CONCURRENCY = 6;

export interface BackfillSummary {
  /** Asset-days the local copy has and Turso lacks. */
  missing: number;
  copied: number;
  candles: number;
  /** Turso refused writes before all were copied; the rest wait for a later run. */
  blocked: boolean;
}

export interface BackfillEvents {
  start(assetDays: number): void;
  day(): void;
}

/**
 * Copies complete days that only the local copy has (saved while Turso refused writes) into Turso,
 * oldest first, with the same collectedAt so both copies count as the same version. Stops quietly
 * when Turso refuses writes again; the rest wait for the next run.
 */
export async function backfillTurso(
  turso: Pick<CandleDb, "completeDays" | "saveDay">,
  local: Pick<LocalCandleCache, "dayVersions" | "rawCandles">,
  size: number,
  events?: BackfillEvents,
): Promise<BackfillSummary> {
  const inTurso = await turso.completeDays(size);
  const missing = [...local.dayVersions(size)]
    .filter(([key]) => !inTurso.has(key))
    .map(([key, collectedAt]) => {
      const [activeId, day] = key.split("|") as [string, string];
      return { activeId: Number(activeId), day, collectedAt };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.activeId - b.activeId);
  const summary: BackfillSummary = { missing: missing.length, copied: 0, candles: 0, blocked: false };
  if (missing.length === 0) return summary;

  events?.start(missing.length);
  await mapWithConcurrency(missing, CONCURRENCY, async (d) => {
    if (summary.blocked) return;
    const start = Date.parse(`${d.day}T00:00:00Z`) / 1000;
    const candles = local.rawCandles(d.activeId, size, start, start + DAY_S);
    try {
      await turso.saveDay({ activeId: d.activeId, size, day: d.day, status: "complete", candles, collectedAt: new Date(d.collectedAt) });
    } catch (error) {
      if (!isWriteBlocked(error)) throw error;
      summary.blocked = true;
      return;
    }
    summary.copied++;
    summary.candles += candles.length;
    events?.day();
  });
  return summary;
}
