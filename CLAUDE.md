# SHIFT — agent guide
Android (Expo RN) app + Node executor "crank" wrapping ORE's `Automate` as clock in / shift / payslip / clock out.
Hard deadline 9 Oct 2026 06:59 UTC; feature freeze 8 Oct 18:00 UTC. **`docs/PRD.md` is the source of truth.**
PRD IDs (F*, FR-*, AC-*, E-*, NFR-*, Q-*) are the vocabulary: cite them in code comments, tests, commits, notes.

## Commands (repo root)
- `npm test` — Vitest (codec, domain, crank). `npm run test:watch`
- `npm run typecheck` — tsc strict across codec, crank, app
- `npm run lint` — ESLint (packages, crank, scripts); app has its own `npm run lint:check -w app`
- `npm run fetch-fixtures` — READ-ONLY mainnet account dump (needs `RPC_URL`)
- App: `npm run android -w app` (dev build, not Expo Go). Crank: `DRY_RUN=1 npx tsx crank/src/index.ts`

## Repo map
- `app/` Expo app: `src/screens`, `src/services`, `src/domain` (planShift, reconcile, streak, memo), `src/config`
- `packages/codec/` `@shift/codec`: PDAs, decoders, ix builders, memo. Fixtures in `test/fixtures/`
- `crank/` executor service (executor-deploy path ONLY, AC-4.5)
- `docs/` PRD, ORE_NOTES (byte layouts w/ file:line citations), TRUST_MODEL, DEVICE_TEST
- `OPEN_QUESTIONS.md`, `PROGRESS.md`

## Rules (condensed)
1. Don't guess; flag. Ambiguity -> OPEN_QUESTIONS.md entry, then ask if blocking. Never invent ORE layouts/PDAs/discriminators/accounts/program IDs: each traces to pinned `ore-api` file:line in `docs/ORE_NOTES.md`. PRD [VERIFY] items are blocked until verified.
2. Money safety: never send a mainnet tx; never run crank without `DRY_RUN=1` unless user says "go live" this session. Never generate/print/commit/log private keys (env only). Enforce NFR-S3 (deposit = budget, <= 0.5 SOL) and NFR-S4 (reload = 0) in code + unit tests.
3. Priority order P0 -> P1; no P1 until all P0 ACs pass. No PRD §12 features; no deps beyond PRD §9.5 without asking.
4. Small steps: explore, plan, implement, test, update PROGRESS.md, commit (Conventional Commits with IDs, e.g. `feat(codec): automate ix (F3, AC-3.1)`).
5. Tests alongside logic (Vitest). Decoders tested against real mainnet fixtures; builders byte-compared with ORE_NOTES. Device-only checks go to `docs/DEVICE_TEST.md`; wait for user results before marking passed.
6. Report honestly; never weaken a test/AC — raise an open question.
7. Done = ACs passing in PROGRESS.md (with verification method) + tests green + lint clean + committed.

## Cluster switch
One `CLUSTER` constant drives RPC, MWA chain and program IDs (E-23); non-mainnet shows a DEVNET badge.
