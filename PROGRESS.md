# Progress

## 2026-10-06 Phase 5 — reconciler, payslip, active screen (built + unit-verified; AWAITING device S-4)
- Done (384 unit tests green; app tsc + expo lint clean; Metro bundles 1825 modules):
  - Executor public key F5YF...m4Ucm set in app/eas.json (smoke + release) and committed; wallet shows 0 SOL (needs funding before any go-live). OQ-7 accepted / OQ-8 resolved; PRD v1.5: AC-6.5 + AC-8.1 copy + P2 feature F14.
  - domain/reconcile.ts: pure state machine (pending/active/paused/complete/paying/paid) + payslip formulas on Miner lifetime counters; older shifts end at the next clock-in baselines (no double counting); AC-6.3 (ORE counter drop -> claimedElsewhere, never negative), E-7 earlier rewards, E-17, E-25, deployed clamped to budget. 30 fixture tests incl. every state.
  - domain/refresh.ts: <=3 RPC calls (steady state 2: accounts incl. wallet balance + incremental signatures with until=lastSeenSig; +1 only for a NEW clock-out to learn the ORE it delivered), 60-day backfill on an empty cache, paging only on full pages, cursor advances only after full success, wallet-keyed SQLite cache (real SQL tested via node:sqlite), cached fallback on any failure (AC-5.2), LAYOUT_MISMATCH -> maintenance (E-11). 26 tests.
  - UI: Home (no shift / running / complete + AC-6.5 notice), Active (progress bar+text, time left, balance, ~live returns, Paused text, Complete -> "Shift complete — see payslip" AC-5.3, pending clock-in handling, early end-shift), Payslip (losses first, sign+label net, PAID, history). Cache-first paint, refresh on focus / pull / every 30 s foreground only.
  - scripts/payslip-check.ts (read-only AC-6.1 helper; same code path as the app, in-memory cache == the reinstall path).
- AC status: AC-6.4 PASSING (pure fixture-tested reconcile); AC-6.3 logic PASSING (unit); NFR-P3 call budget PASSING (unit, counted); AC-6.5 copy unit-tested, display pending device. Device pending S-4: AC-5.1, AC-5.2, AC-5.3, AC-6.1, AC-6.2, AC-6.5.
- Deviations to note: progress is a bar with text (no react-native-svg dependency; PRD says ring); PRD schema gap fixed (cache keyed by wallet); paid-shift ORE is NET of ORE fee read from the OUT tx (unpaid is gross) and labelled accordingly.
- Not yet: crank status for Paused comes from /health (F11, P1): reconcile supports it and is tested, the app passes crankStatus unknown. Clock out (Phase 6) is a disabled button.
- Next: Phase 6 clock-out (Checkpoint if needed + ClaimORE + ClaimSOL only if >0 + close if open + OUT memo in one tx) — can proceed in parallel with your S-3/S-4 runs.

## 2026-10-06 Phase 4 — crank (built, DRY-RUN ONLY; nothing sent, no key generated or handled)
- Done (319 unit tests green, tsc + eslint clean):
  - crank/src: config (dry-run default; live needs DRY_RUN=0 AND ACKNOWLEDGE_LIVE; secret dropped in dry-run; bad keys never echoed; RPC URL path/query never logged), plan (Preferred only, funded for one round, never creates a Miner, checkpoint-before-deploy, "waiting" round is open), batch (greedy packing under the 1232-byte limit, runtime guard assertCrankInstructions), submit (DryRunSubmitter structurally cannot send; LiveSubmitter exists but is unreachable without both locks), health (/health incl. roundStalled, lowBalance, slotLag), loop (never throws, failure isolation, stateless restart).
  - AC-4.5 PASSING (source-scan test + runtime guard); AC-4.2 PASSING (unit: boundary at exactly one round, depleted never errors); AC-4.3 PASSING at unit level (fresh instance == same behaviour; real restart is part of the live 30-min test); AC-4.7 PASSING (tests + clean-room run: DRY_RUN=0 alone exits 2); FR-4.1 /health served and checked over HTTP; FR-4.2 dry-run.
  - Integration vs mainnet (read-only): scripts/crank-dryrun-permissionless.ts ran the real planner+batcher+DryRunSubmitter on 12 live Preferred automations (permissionless executor accepts any signer): 12/12 simulated OK, ~22k CU each. Real process run: banner, /health JSON, 0 errors. ORE bots had already deployed all 35 active ones that round -> planner correctly produced no work (idempotent).
  - Ops: crank/Dockerfile, .dockerignore, railway.json, crank/.env.example, docs/CRANK_RUNBOOK.md, scripts/gen-executor-key.mjs (NOT run; tested structurally: refuses overwrite, prints secret only behind a flag).
- NOT verified: AC-4.1 (30-min liveness), AC-4.4 (needs your SHIFT automation after S-3), AC-4.6 (needs live crank + tiny shift), the Docker image build (no Docker daemon here; clean-room npm ci + start from a trimmed copy worked).
- Open: OQ-7 final-round checkpoint limitation (documented), OQ-8 ComputeBudget disclosure (confirm).
- Next: when you send the executor public key I set EXPO_PUBLIC_CRANK_PUBKEY in app/eas.json and commit; then S-3. After S-3: AC-4.4 dry-run on your automation. Phase 5 (reconcile/payslip/active screen) can start in parallel.

## 2026-10-06 Phase 3 — clock in (built + unit-verified; AWAITING executor public key + device S-3)
- Done earlier today (S-2 findings): rent is now read live only (cluster rent changed 6960 -> 5080 lamports/byte; ORE charges exactly the RPC minimum, proven by simulation), no rent constants in shipped source (unit scan + RUN_LIVE drift check); budget line copy; Diagnostics sample optional. PRD v1.3.
- Done (219 unit tests green, app tsc + expo lint clean, Metro bundles 1815 modules):
  - domain/clockIn.ts: builder [stop (idle shell only)] -> Automate -> IN memo (baselines from Miner, setupLamports, date/tz); pre-sign guard re-decoding the real instructions (NFR-S2/S3/S4: deposit == displayed budget and <= 0.5 SOL, reload bytes 0, Preferred, executor == crank, own PDAs only, one memo last, no other programs; tamper tests); describeSimError.
  - domain/clockInFlow.ts (pure, dependency-injected): fresh read + conflict check, balance re-check, simulate BEFORE the wallet (AC-3.3), E-2 decline -> cancelled, unknown send -> wait for blockhash expiry then reconcile (automation by crank or matching IN memo) before any retry (AC-3.4, E-3, E-4), never touches a foreign automation (AC-3.5). Shared submitAndConfirm also powers the early end-shift.
  - UI: Setup Clock in -> /clockin (final confirm, status texts, outcome handling, re-entrancy guard) -> /active (reads chain; budget left, rounds covered, explorer link) ; Home shows a running shift.
  - SCOPE NOTE (flag): added an early slice of F7, "End shift & withdraw" (stop instruction + confirmation of the returned amount), so test funds are never stranded before Phase 4/6. Phase 6 still owns Checkpoint/ClaimORE/ClaimSOL/OUT memo and AC-7.x.
- AC status: unit-verified, device pending S-3: AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, E-2 (E-3/E-4 logic unit-tested). NFR-S3/NFR-S4 invariants: unit-tested at builder AND pre-sign-guard level. AC-1.5 still deferred: it is exercised by the first signing action in S-3.
- Blocked on user: (1) the executor PUBLIC key for EXPO_PUBLIC_CRANK_PUBKEY (eas.json smoke env); (2) running DEVICE_TEST S-3 (spends real SOL: ~0.0045 net).
- Next: Phase 4 (crank, DRY_RUN only until you say go live): round loop, Deploy + Checkpoint, /health, AC-4.x incl. AC-4.6.

## 2026-10-05 Phase 2 — wallet, planShift, Welcome/Home/Setup (AWAITING DEVICE S-2)
- Done (verified by unit tests, 166 green; app tsc + expo lint clean; Metro bundles 1809 modules):
  - AC-2.4 PASSING: planShift unit tests (all 27 preset combos, hand-computed values, MIN_PER_SQUARE and 5% fee boundaries incl. exact thresholds, NFR-S3 cap, property sweep).
  - Logic proven by unit tests, display/flow pending device S-2: AC-2.1 (max-loss figure == budget to 4 dp), AC-2.2 (shortening + reasons), AC-2.3 (balance check, shortfall rounded up), AC-2.5 (Refundable/Not refundable lines, omitted when not charged), AC-1.3/1.4 classification (message observed on device in S-1), AC-1.2/1.5 auth-cache serialisation (round-trip, corrupt entries rejected; found+fixed: 0-byte address decoded to the all-zero key).
  - Services: SecureStoreAuthCache (token only in expo-secure-store), useShiftWallet (typed connect result, disconnect clears), loadWalletChainState (1 getMultipleAccounts + cached rents).
  - Screens: index gate, Welcome (incl. no-wallet panel + Play Store link), Home (no-shift), Setup + Review card (all FR-2.1 fields), Risks (NFR-RD2), Diagnostics. Clock in is a disabled button: NO signing code exists yet. Removed template demo features (arbitrary sign-message/transaction samples).
- Not verified on device: everything in docs/DEVICE_TEST.md S-2 (AC-1.1, 1.2, 1.3, 1.4, 2.1-2.3, 2.5 display, a11y NFR-A1-A5 spot checks). AC-1.5 deferred to Phase 3 (needs a signing action).
- Note for user: with a 0.05 SOL wallet and no Miner, only the 0.02 SOL budget fits (total leaving now 0.02595344 SOL at the 2026-10-06 rent, + 0.01 reserve); 0.05 SOL budget needs ~0.066 SOL.
- Next: wait for S-2. Then Phase 3 (clock in): needs the crank PUBLIC key (EXPO_PUBLIC_CRANK_PUBKEY) from you; conflict check wiring, simulate, MWA signAndSend, reconcile-before-retry, NFR-S3/S4 invariants.

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
