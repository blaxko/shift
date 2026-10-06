# Crank go-live test plan

Goal: after your S-3, prove the crank on mainnet with one small shift, in this order, with every step mapped to what you do on the phone, what you do on the computer, and what you send me.

**Order of the gates (nothing skips ahead):**
`AC-4.4` dry-run on YOUR automation → **your explicit "go live"** → `AC-4.1` 30-minute liveness → `AC-4.3` restart → `AC-4.6` run to zero → clock-out with real rewards.

One 1-hour shift (the default preset) serves all of it: 46 rounds ≈ 60 minutes, and the first 30 minutes are the AC-4.1 measurement.

## What it can cost you
- **At risk:** the shift budget, **0.02 SOL**, is the most you can lose from the game. Executor fees (0.000046 SOL for 46 rounds) come out of it.
- **Setup:** none if S-3 already created your Miner (it did: 0.0044804 SOL, one time).
- **The executor wallet** spends about 0.0002 SOL for the whole run (about 0.000005 SOL per transaction); you are funding it with ~0.03 SOL. Its executor fee income is smaller than its transaction cost with a single user; that is expected and tiny.
- Your phone wallet needs about **0.035 SOL** to start the shift (budget 0.02 + deposit 0.00146 + the app's 0.01 safety reserve + fees).

## Prerequisites (tick before Stage A)
- [ ] S-3 passed (clock-in, the ONE transaction, end shift): the app and the on-chain flow work.
- [ ] S-4/S-5 run if you can (not blocking for the crank test).
- [ ] Executor funded ~0.03 SOL; **tell me** (I will check `/health`).
- [ ] RPC URL from a provider (not the public endpoint), saved somewhere private.
- [ ] `node scripts/secret-scan.mjs` says CLEAN (it did on 2026-10-06), repo pushed to GitHub.
- [ ] Railway deployed in **dry-run** and `/health` checked (`docs/RAILWAY_RUNBOOK.md` steps 1–3). Send me the `/health` text.
- [ ] Phone has the latest build (EAS) with `EXPO_PUBLIC_CRANK_PUBKEY` = `F5YF…m4Ucm`.

---

## Stage A — AC-4.4: dry-run against your SHIFT automation (no transaction is sent)

| # | You on the phone | You on the computer | Expect | Send me |
|---|---|---|---|---|
| A1 | Open SHIFT → Start a shift → defaults (Balanced, 0.0200 SOL, 1 h) → Clock in → approve | Note the time (T0) | "Your shift is running", **0 of 46 rounds**, budget left 0.0200 SOL | the clock-in signature |
| A2 | Nothing | Railway → Deployments → View Logs, and `/health` in a browser | within about one round (~80 s): `round_worked … "mode":"DRY_RUN"` and `batch_simulated_ok` with `unitsConsumed`; `/health` shows `"activeAutomations":1` and `lastRoundDeployedAt` set. Repeated `batch_simulated_ok` about every 12 s is normal in dry-run (nothing is really deployed). **The phone still shows 0 rounds, correctly** | 3 `batch_simulated_ok` log lines + the `/health` text |
| A3 | Nothing | `npx tsx scripts/payslip-check.ts <your wallet>` | Automation: balance 20,000,000, executor `F5YF…`, strategy 1 | the output |

**Pass (AC-4.4):** a successful simulation for your automation. A `simulated-fail` instead means STOP here and send me the log line; do not go live.

## Stage B — your explicit "go live"

1. **You tell me "go live" in the chat.** I will check the prerequisites and reply with a short confirmation. I never flip it myself and I never see the secret.
2. You do `docs/RAILWAY_RUNBOOK.md` section 4 (paste the secret from the file, `ACKNOWLEDGE_LIVE`, `DRY_RUN=0`, Deploy).
3. Verify: `/health` says `"mode":"LIVE"`; logs show `starting_LIVE`, then within about one round `batch_sent` with a `signature`.
4. Open that signature on an explorer: the transaction is signed by `F5YF…`, the program is ORE, and your wallet appears as the authority.
5. Phone: pull to refresh on **Your shift is running** → **1 of 46 rounds** (then it counts up).

Send me: the `starting_LIVE` line, the first `batch_sent` line, the explorer link, and a screenshot of the phone.

**If anything looks wrong at any moment → Stop (RAILWAY_RUNBOOK §5).** Nothing is lost: your budget is in your ORE automation and **End shift & withdraw** works without the crank.

## Stage C — AC-4.1: 30-minute liveness (≥ 98 % of rounds)

| # | Phone | Computer | Expect |
|---|---|---|---|
| C1 | Lock the phone and put it down (that is the product) | The moment `batch_sent` appears for round 1: `npx tsx scripts/liveness.ts snapshot <wallet>` | `saved liveness-start.json …` |
| C2 | After ~10 min: **force-stop the app** (recents → swipe away), reopen | — | still **Your shift is running** with rounds counting (AC-6.1 / E-13); no duplicate shift |
| C3 | — | At **T1 + 30 min**: `npx tsx scripts/liveness.ts report <wallet>` | prints rounds that happened / deployed / missed and `RATE xx % → PASS/FAIL` |

Honest note on the threshold: 30 minutes is only about **23 rounds**, and 98 % of 23 allows **zero** misses. The measurement is exact (it counts from chain counters, not logs), so one missed round shows as 95.7 % FAIL. If that happens, send me the output and the logs around the missed round (RPC hiccup? ORE stall?) rather than rerunning blindly; for a statistically meaningful read we can also measure the full 46-round shift (allows one miss).

Send me: the `report` output.

## Stage D — AC-4.3: restart test (after the 30-minute window)

| # | You | Expect |
|---|---|---|
| D1 | Railway → Deployments → ⋯ → **Restart** | the crank is down for a short moment |
| D2 | Watch the logs and the phone | `starting_LIVE` again, then `round_worked` within about one round (~80 s); the phone's round count keeps going; **no local state was needed** |

Do this *after* C3 so the restart gap cannot count against the 30-minute measurement.

## Stage E — AC-4.6: run the shift down to zero

Let the shift keep running to the end (46 rounds ≈ 60 minutes from T1). Keep the phone locked; peek now and then.

| Check | How | Expect |
|---|---|---|
| (a) final rounds deploy with **no rent error** | Railway logs near the end | no `automation_skipped_this_round` with `InsufficientFundsForRent`; the last `batch_sent` lines succeed |
| (b) ORE **auto-closes** the automation | `npx tsx scripts/payslip-check.ts <wallet>` | `Automation: none` |
| (c) **balance + rent return** | wallet balance now vs just after clock-in (call it B0) | now ≈ B0 + (SOL returned by ORE during rounds) + (unspent budget under one round, ≤ 0.00043) + 0.00146304 rent. The `payslip-check` output lists `returned-by-ORE` and `unspent-returned` to compare. No transaction was signed by you, so no network fee |
| (d) app shows **Complete** | phone: Home | "Shift complete"; the payslip numbers equal `payslip-check` to the lamport (AC-6.1). **The amber "Clock out within 24 h…" notice should now appear** (an unchecked final round with a deployment: AC-6.5) |

Send me: the `payslip-check` output, the phone screenshots (Home and Payslip), and balances before/after.

**Pass (AC-4.6):** (a)–(d) all as expected. A rent error or an automation that is still there after the budget ran out → stop and send me the logs: that becomes an open question about a rent-safe margin in `planShift` before any code change.

## Stage F — clock out with real rewards (completes the loop)

| # | Phone | Expect |
|---|---|---|
| F1 | Payslip → **Clock out & collect** → confirm → approve | ONE transaction: **Checkpoint** (settles the last round) → **ClaimORE** (only if you earned ORE) → OUT memo. (No close: ORE already closed the automation.) |
| F2 | Look at the result | **Payslip — PAID**; SOL returned by the checkpoint lands in your wallet; ORE (if any) arrives in your ORE token account, shown net of ORE's 10 % fee on mined ORE; the amber notice is gone |
| F3 | Force-stop and reopen; later **Clear data** and reconnect | still PAID with the same numbers (AC-6.2) |

This is the first time the Checkpoint look-ahead and ClaimORE run with real rewards: send me the transaction signature.

## Stage G — stand down
Set `DRY_RUN` back to `1` and remove `ACKNOWLEDGE_LIVE` and `EXECUTOR_KEYPAIR` (RAILWAY_RUNBOOK §5), or leave it live if you want to keep testing. After this, the P0 checkpoint report can be written and Phase 7 continues with P1.

---

## What I need from you, in one list
`/health` after the dry-run deploy · executor funded (yes/no) · Stage A logs → your "go live" → Stage B proof → Stage C report → Stage D confirmation → Stage E outputs → Stage F signature.

## Abort rules (stop, do not push on)
- `/health` shows `ok:false`, `roundStalled:true` for more than a few minutes, or `lowBalance:true`.
- Any `simulated-fail` / unexpected error in the logs that I have not explained.
- The phone shows a duplicate shift, a wrong number, or an automation you did not start.
- Anything that looks like money moving that you did not expect.
In every case: **Stop (RAILWAY_RUNBOOK §5)** and use **End shift & withdraw** on the phone if the budget is still in the automation.
