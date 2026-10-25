import type { SessionRule } from "@/domain/backtest/sessions";

/** Settings files must say how we trade; tests that are not about sessions use these. */
export const TEST_SESSIONS: SessionRule[] = [
  { minutes: 60, takeProfitMultiplier: 10, stopLossRounds: 1 },
  { minutes: 30 },
];
