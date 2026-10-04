# Progress

## 2026-10-04 Phase 1 — codec (complete; Phase 0 approved)
- Done:
  - Phase 0 closed: ORE notes approved; ROUND_SECONDS = 78 measured (53 consecutive mainnet rounds, method in ORE_NOTES §7.6a); PRD v1.1 applied (change-log entry); OQ-1..5 resolved; smoke import removed.
  - Checkpoint source review (decision 2) -> docs/TRUST_MODEL.md. **Finding:** Checkpoint can pay the *caller* one thing: the user's pre-paid 10 000-lamport checkpoint reserve, only for rounds unchecked for >= 12 h (checkpoint.rs:64-66,223). All rewards go only to the user's wallet/Automation/Miner. A prompt crank collects nothing.
  - Codec builders: automate (V2, Preferred, reload hard-wired 0), stopAutomation, executorDeploy, checkpoint, claimSol, claimOre, shiftMemo; memo format/parse (strict, E-20), extractMemoTexts. 95 Vitest tests green (golden byte vectors, account order/flags, NFR-S3/S4 invariants, 52 memo accept/reject cases).
  - Live read-only simulation vs mainnet (ORE_NOTES §10): A idle-shell [stop, automate] in ONE tx OK (FR-3.1 proof); B fresh [automate, memo] OK + AC-3.2 post-state; C claimOre/claimSol/checkpoint OK; D executorDeploy: ORE ran Deploy to success; tx-level rent error is on a legacy fixture automation (re-confirm Phase 4).
  - Found & fixed in notes: Config's entropy fields are stale; Deploy uses VAR_ADDRESS + entropy-api ID 3jSkUuYB... (derivation reproduced in test).
  - Metro bundles the real codec (1777 modules, Hermes bundle contains codec strings).
- ACs: none marked passing yet (they are app-level; evidence so far is builder-level): AC-3.1 (one tx with Automate + IN memo) builder part proven by simulation B; AC-3.2 on-chain state proven by simulation post-state; NFR-S3/S4 unit-tested. Will be marked passing when the app flow exists (Phase 3) and the device clock-in is confirmed.
- Failing / blocked: none. Open note: Hermes runtime behaviour of 'buffer' + BigInt is only bundle-verified, not run on device (DEVICE_TEST in Phase 2/3).
- Next: Phase 2 — services/wallet.ts (MWA via @wallet-ui/react-native-web3js, secure-store auth token), domain/planShift.ts + tests (AC-2.1/2.2/2.4 incl. MIN_PER_SQUARE=1000, fee<=5% rule, ROUND_SECONDS=78, EXECUTOR_FEE=1000), balance check (AC-2.3), Welcome/Home/Setup/Review screens.

## 2026-10-04 Phase 0
- Done: 0.1-0.5 (see git log); decoders + fixtures (16 tests). Approved by user.
