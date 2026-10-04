# Progress

## 2026-10-04 Phase 2 task #1 — device smoke build (AWAITING USER DEVICE RESULT, docs/DEVICE_TEST.md S-1)
- Done:
  - Checkpoint reserve source trace (ORE_NOTES §7.12): reserve (10 000) and Miner rent (6 124 800) are NOT refundable; Automation rent (2 004 480) IS. Added `setupLamports` to the IN memo (13 fields), payslip nets setup cost, FR-2.1 breakdown labels each cost Refundable / Not refundable, new AC-2.5. PRD v1.2. 98 codec tests green.
  - AC-4.6 (end-of-shift run-down test) added to PRD. Rent-bite analysis: a SHIFT automation holds rent + balance and every outflow is <= balance or a full close, so no planShift margin is needed in theory; verified on chain in Phase 4. The ORE_NOTES §10 rent error was on a legacy under-funded fixture account.
  - Smoke build: app/src/screens/SmokeScreen.tsx (MWA connect, 1-RPC getMultipleAccounts, decode Board/Config/Automation(/your Automation+Miner) via @shift/codec, 9 on-device self-checks incl. Buffer/BigInt/PDA/builders/secure-store/sqlite); CLUSTER constant (E-23) drives RPC+MWA chain; app renamed SHIFT, package app.shift.seeker (OQ-6); eas.json profile smoke (APK). Added expo-secure-store + expo-sqlite (PRD §9.5) now so one native build covers Phases 2-5.
  - Verified locally: app tsc clean, expo lint exit 0, expo prebuild (config plugins) OK, Metro android export bundles 1791 modules and contains the smoke strings.
- Not verified: anything on device. No JDK/Android SDK on this machine, so the APK must come from an EAS cloud build (steps in DEVICE_TEST S-1).
- Next: wait for S-1 results. Then Phase 2 proper: services/wallet.ts (SecureStore auth cache via MobileWalletProvider cache prop), planShift + tests, balance check, Welcome/Home/Setup/Review screens.

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
