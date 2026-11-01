# iq-robot signal code (frozen reference)

Verbatim copy of the bot's signal calculation, used only by tests to prove that
`src/domain/signal` produces exactly the same signals.

- Source: iq-robot `f34d0ee` (signal files last changed in `bdc1edc`, 2026-02-22)
  - `src/utils/indicators/signalWithCandleCalculator.ts` -> `signalWithCandleCalculator.ts`
  - `src/utils/indicators/{supportResistance,donchian,bollingerBands,stochastic,rsi,consecutiveCandleColors}.ts` -> `indicators/`
  - `src/types/indicators/*.ts`, `src/types/signal/Signal.ts` -> `types/`
- Only changes: import paths (`@/types/...` and `./<indicator>` point at the copies here) and a
  `// @ts-nocheck` first line, because this project compiles with stricter settings than iq-robot.
- `current/`: the calculator since 27/10/2026 (iq-robot `0ef1e15`, signal changed in `4d17c92` and
  `3d50c39`): `src/utils/indicators/signalWithCandleCalculator.ts` and
  `src/utils/indicators/config/{signalSettings.ts,signal-settings.json}`. %K only, no size rule.
  It shares `indicators/` and `types/` above, which did not change. The files at the top level are
  the bot before 27/10/2026 (%K and %D, size rule), kept to test those switches.
- Never edit the logic. When the bot's signal changes, copy the files again and update this README;
  the equivalence tests then show what changed.
