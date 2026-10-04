# Progress

## 2026-10-04 Phase 0 (in progress — awaiting user confirmation at 0.6)
- Done:
  - 0.1 repo skeleton — workspaces (app, packages/codec, crank), strict TS, ESLint, Vitest, .gitignore (keys/.env first), .env.example. Template `web3js-expo-minimal` (see OQ-1: wraps MWA via `@wallet-ui/react-native-web3js`).
  - 0.2 CLAUDE.md (≤60 lines).
  - 0.3 Metro resolves `@shift/codec`: `expo export --platform android` bundled 1770 modules and the Hermes bundle contains the codec marker string. No fallback needed. (Smoke import in `app/app/index.tsx` + `CODEC_SMOKE` to remove after Phase 1.)
  - 0.4 `docs/ORE_NOTES.md`: pinned ore-api 3.8.25 @ 48c203bd (OtterSec verify API: deployed program is built from this exact commit). Q-1..Q-7 answered with file:line.
  - 0.5 fixtures: 4 automation, 4 miner, 4 round, board, treasury, config (slot ≈453346683, 2026-10-04).
  - Decoders + PDAs (read-only, no tx code): 16 Vitest tests green (fixtures parse; E-11 LayoutMismatch for owner/size/discriminator). typecheck + eslint clean.
- Failing / blocked: Phase 3/4/5 design changes needed — OQ-2 (crank checkpoint vs AC-4.5), OQ-3 (payslip model/IN memo), OQ-4 (idle automations), OQ-5 (fee, min deploy, Reset). No AC passing yet (none verifiable before Phase 2+).
- Next: user confirms ORE_NOTES + answers OQ-2..5; then Phase 1 codec builders (automate, executorDeploy, checkpoint, claimSol, claimOre, stopAutomation, shiftMemo, memo parser).
