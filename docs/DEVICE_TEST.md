# Device tests

Things only a physical Seeker can prove. Claude cannot run these; results are reported back by the user and only then do the related ACs move to "passing" in `PROGRESS.md`.

Record for every run: date, device model + Android version, build (git commit), pass/fail per line, screenshots.

---

## S-1 — Device smoke build (Phase 2 task #1)

**Purpose:** before any real screen is built, prove on a real Seeker that the pieces the app depends on actually run on Hermes: MWA connect (Seed Vault), live RPC, `@shift/codec` decoding of live Board / Config / Automation accounts, `Buffer` + `BigInt` + PDA derivation + instruction builders, `expo-secure-store`, `expo-sqlite`. The screen builds **no transaction for signing** and sends nothing.

### Build (Option A — recommended: EAS cloud build, no Android toolchain needed)

This machine has no JDK / Android SDK, so use EAS. Free Expo account is enough. From the repo root, in PowerShell:

```powershell
git pull                      # make sure you have the commit that contains docs/DEVICE_TEST.md S-1
npm install                   # root install (npm workspaces)
cd app
npx eas-cli@latest login      # your Expo account
npx eas-cli@latest init       # links/creates the EAS project; adds extra.eas.projectId to app.json
git add app.json; git commit -m "chore(app): link EAS project"   # EAS builds from git-tracked files
npx eas-cli@latest build --platform android --profile smoke
```

- Profile `smoke` (in `app/eas.json`) produces an installable **APK** with the JS bundled inside — no Metro/dev server needed.
- Android package id is `app.shift.seeker` (placeholder, see OPEN_QUESTIONS OQ-6 — tell me if you want a different one before the dApp Store).
- Build takes roughly 10–20 minutes. It prints a URL to the build page / APK.
- The app talks to the public mainnet RPC (`api.mainnet-beta.solana.com`) by default. If you see HTTP 429 errors in the screen, set a throwaway RPC key in the `smoke` profile's `env` as `EXPO_PUBLIC_RPC_URL` (anything `EXPO_PUBLIC_*` is embedded in the APK — never use a key you care about).

### Install

1. Easiest: open the EAS build URL **on the Seeker**, download the APK, allow "Install unknown apps" for the browser when asked, install.
2. Or from the PC with USB debugging on: `adb install -r path\to\shift-smoke.apk`.

### Build (Option B — local; not verified on this machine)

Needs JDK 17, Android Studio with SDK platform 36 + build-tools, `ANDROID_HOME` set. Then in `app/`: `npx expo run:android --variant release --device`. Only use this if EAS is a problem.

### Checks (please run in order and report each)

| ID | Step | Expected | Result |
|---|---|---|---|
| S-1.1 | Open the app | Title "SHIFT — device smoke test"; `cluster mainnet-beta`; **no** "DEVNET" text; no crash | |
| S-1.2 | Scroll to section 3 "On-device self-test" (runs on launch, no network) | Header says **(9/9 pass)**; all 9 lines green `PASS`. If any `FAIL`, copy the line text — it names the broken piece (Buffer / BigInt / PDA / builder / secure-store / sqlite) | |
| S-1.3 | Tap **Fetch & decode** *without* connecting | Green "1 RPC call, N ms"; board round number; `board slots A → B (len 240)`; `config round_slots 240, intermission 48`; sample automation block (balance/amount/fee/executor/strategy/mask) — no red `ERROR` | |
| S-1.4 | Compare to chain: open `https://explorer.solana.com/address/BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi` (Board account) at about the same time | Round id on screen equals or is within 1–2 of the explorer's current ORE round (rounds advance every ~78 s); length 240 | |
| S-1.5 | Tap **Connect wallet** | Seed Vault / wallet approval sheet opens and names the app **SHIFT**. Approve. Screen then shows your full address and a SOL balance that matches your wallet app | |
| S-1.6 | Tap **Fetch & decode** again (now connected) | Extra lines: `your Automation: none` and `your Miner: none` if this wallet never used ORE (otherwise real numbers). No `ERROR` | |
| S-1.7 | Force-stop the app (recents → swipe away), reopen | **Informational (FR-1.2):** note whether the wallet is still shown as connected without a new approval prompt. Either result is fine for this test; I need to know | |
| S-1.8 | Turn on airplane mode, tap **Fetch & decode** | Red `ERROR …` text, app stays responsive, no crash. Turn airplane mode off, fetch works again | |
| S-1.9 | Tap **Disconnect** | Returns to the Connect button | |

### Please report back
- Pass/fail for S-1.1 … S-1.9 (copy any red text exactly).
- Device model and Android version; the "N ms" from S-1.3; roughly how long the cold start took.
- One screenshot of the self-test section and one of the live-chain section.

On any failure: if you have `adb`, `adb logcat -s ReactNativeJS:V ReactNative:V *:E` during the failing step is the most useful thing to paste.

## S-1 RESULT — 2026-10-05: ALL PASS (reported by user)
- Device 21061119AG (not a Seeker), Android per user, wallet Phantom. Self-test 9/9 PASS. Connect PASS (after installing an MWA wallet). Fetch & decode PASS: 1 RPC call, 916 ms; board round 428557, slot length 240; config round_slots 240 / intermission 48; sample automation decoded (fee 7000, reload 1, executor `executor11…`); own Automation: none, Miner: none.
- Findings: (1) Play Protect blocks the sideloaded APK; "Install anyway" works -> README judge install note (Phase 8). (2) With no MWA wallet installed the library throws "Found no installed wallet that supports the mobile wallet protocol" -> AC-1.3 friendly screen (built in Phase 2). (3) Not yet verified on a real Seeker / Seed Vault.

**Gate (met):** Phase 2 screens (Welcome, Home, Setup, Review) are not built on top of this until S-1 passes.

---

## S-2 — Phase 2: connect flow + Setup/Review (F1, F2)

**Build:** same steps as S-1 (`cd app; npx eas-cli@latest build --platform android --profile smoke` after `git pull`; profile `smoke` is the standard test APK). Install over the previous one (or uninstall first for S-2.1). An MWA wallet (Phantom is fine) must be installed for S-2.2+. Test wallet funded with ~0.05 SOL and **no ORE Miner yet** (a never-used wallet). Nothing in this build signs or sends anything; "Clock in" is deliberately disabled.

| ID | AC | Step | Expected | Result |
|---|---|---|---|---|
| S-2.1 | F1 | Fresh install, open | **Welcome**: "Clock in once. ORE works your shift.", three bullets, **Connect wallet**, "How SHIFT works & risks". No crash | |
| S-2.2 | AC-1.1 | Tap **Connect wallet**, approve in the wallet | **Home** appears within ~2 s of approval: "SHIFT", Wallet `xxxx..xxxx` (abbreviated), Balance matching the wallet app, "No shift today", **Start a shift** | |
| S-2.3 | AC-1.2 | Force-stop SHIFT (recents → swipe away), reopen | Goes **straight to Home** (brief spinner at most) with **no wallet approval prompt** | |
| S-2.4 | FR-1.4 | Tap **Disconnect wallet** | Back on Welcome. Force-stop + reopen → Welcome again (not Home). **Connect wallet** works again | |
| S-2.5 | AC-1.4 | Connect, but **decline** in the wallet | Back on Welcome with a calm banner "Cancelled — nothing was sent"; Connect works again; no crash | |
| S-2.6 | AC-1.3 | (Only if easy) disable/uninstall the MWA wallet, tap Connect | Panel **"No compatible wallet found"** + explanation + **Find a wallet on Google Play** (opens a Play Store search) + **Try again**. After reinstalling the wallet, Try again connects. No crash. Tap **Details**: raw text appears only there | |
| S-2.7 | AC-1.5 | **Deferred to Phase 3** (needs a signing action to hit a rejected token). Note for later: revoke SHIFT in the wallet's connected-apps list, then sign | n/a | |
| S-2.8 | AC-2.1, 2.5, FR-2.1 | Home → **Start a shift**. Defaults should be Balanced / 0.0200 SOL / 1 h. Scroll to **Review** | Bold line **"Max you can lose: 0.0200 SOL"**; Role Balanced; Each round `0.00…` SOL × 10 squares; **Estimated rounds 46**; Estimated end ≈ now + 59 min; Executor fees `0.000046 SOL (0.2 % of budget)`; cost lines with labels (below) | |
| | | …cost lines for a **fresh wallet (no Miner)** | `Shift budget — at risk (unspent part returned) 0.02 SOL`; `ORE automation account rent — Refundable 0.00146304 SOL`; `ORE miner account rent — Not refundable 0.0044704 SOL` (rent is read live, so these move if the cluster rent moves; values as of 2026-10-06, confirmed on device); `ORE checkpoint reserve — Not refundable 0.00001 SOL`; `Executor fees (from the budget) — Not refundable 0.000046 SOL`; `Network fee (estimate) — Not refundable 0.00001 SOL`; **Total leaving your wallet now 0.02595344 SOL**; Your balance ≈ your wallet's | |
| S-2.9 | AC-2.3 | Select budget **0.0500 SOL** | Red "Error: Not enough SOL. You need **0.0160** SOL more…" if your balance is exactly 0.0500 (shortfall = 0.06595344 − balance, rounded **up**). Total leaving now becomes 0.05595344 SOL. **Clock in** stays disabled | |
| S-2.10 | AC-2.2 | Try every role × length at 0.0200 SOL (e.g. Safe + 8 h, Sniper + 8 h) | Plans appear; **no** "Shortened to …" banner on any preset (at a 1 000-lamport fee none is expected). Safe/0.02/8 h shows **369** rounds | |
| S-2.11 | — | Look at **Clock in** | Disabled (greyed) with a reason line underneath; tapping does nothing and **no wallet prompt appears** | |
| S-2.12 | NFR-RD2 | Open **How SHIFT works & risks** from Welcome, Home and the review card | Readable text; Diagnostics button at the bottom opens the S-1 screen | |
| S-2.13 | NFR-A | Turn on **TalkBack**; Setup screen | Max-loss line is read as "Max you can lose: zero point zero two SOL"; each choice announces selected/not selected; buttons easy to hit. Then set **Font size + Display size to the largest** | No clipped/overlapping amounts in the review card; try **dark mode** too — all text legible | |
| S-2.14 | E-12 | Airplane mode, open Setup | Review shows "Checking your wallet…", an amber notice about the network, and **Retry**; app stays responsive. Airplane off + Retry → costs appear | |

### Please report back
Pass/fail for S-2.1 … S-2.14 (S-2.6 and S-2.13 may be "skipped"), the Total / Balance / shortfall numbers you see in S-2.8–2.9 (they must match the ones above to the digit shown), device + Android version, and one screenshot of the full review card (before and after the 0.0500 SOL switch).

---

## S-3 — Phase 3: ONE real clock-in on mainnet, then end it (F3; AC-3.1, 3.2, 3.3, 3.4, 3.5, E-2)

**This spends real (small) SOL.** Use the funded test wallet. Budget **0.02 SOL**, role **Balanced**, **1 h** (the defaults).

**Before building:** I need the executor's **public** key. Put it in `app/eas.json` under the `smoke` profile's `env` as `"EXPO_PUBLIC_CRANK_PUBKEY": "<public key>"` (I never see or handle the secret), commit, then build + install exactly as in S-1. Without it the **Clock in** button stays disabled with the reason "The SHIFT executor is not configured in this build".

**Important about funds:** the crank is not built yet (Phase 4), so **no rounds will be played** and your 0.02 SOL simply sits in the automation. Step S-3.8 returns it with the app's early **End shift & withdraw** button (the stop instruction; claims + payslip come in Phase 6). If anything goes wrong, ORE's own app can also stop an automation. Note your wallet balance **before** you start.

Expected cost of this whole test (rent is read live, so these are for 2026-10-06 rent): clock-in takes 0.02 + 0.00146304 (refundable rent) + 0.0044704 + 0.00001 (the two non-refundable setup costs) + network fee. Ending the shift returns 0.02 + 0.00146304. **Net cost ≈ 0.0044804 SOL setup + two network fees (~0.00001 total).**

| ID | AC | Step | Expected | Result |
|---|---|---|---|---|
| S-3.1 | — | Home → Start a shift (defaults) → review card → **Clock in** | Button enabled. Opens **Confirm your shift** (Max you can lose 0.0200 SOL, role, rounds 46, executor fees 0.000046). Nothing is signed yet | |
| S-3.2 | E-2 | Tap **Confirm and sign**, then **decline** in the wallet | Banner "Cancelled — nothing was sent." and a **Try again** button. Wallet balance unchanged. Confirming status text appears in order: "Checking your wallet…", "Checking the transaction…", "Approve in your wallet…" | |
| S-3.3 | AC-3.1, 3.2 | Tap **Try again**, **approve** in the wallet | Wallet shows ONE transaction (may show as an ORE program call + memo). Then "Confirming on the network…" and the **Your shift is running** screen: Budget left **0.0200 SOL**; Each round `0.000043378 SOL × 10 squares + fee 0.000001`; Rounds covered **46** | |
| S-3.4 | AC-3.1 | Tap **View the clock-in transaction** (opens explorer) | Exactly one transaction; instructions: **Ore** program (Automate) and **Memo** with text `SHIFT1|IN|balanced|20000000|43378|10|1000|4480400|0|0|0|<your date>|<your tz minutes>` | |
| S-3.5 | AC-3.2 | Compare wallet balance now vs before | Down by ≈ **0.02595344 SOL + one network fee** (0.02 budget + 0.00146304 + 0.0044704 + 0.00001) | |
| S-3.6 | AC-3.5 | Go Home → Start a shift → Clock in again | Home shows **Your shift is running** instead of Start a shift. If you reach the confirm screen and sign: you get "You already have a SHIFT shift running." and **no wallet prompt** | |
| S-3.7 | E-3 (optional, advanced) | Not required. If you want to test it: start a clock-in, and while the wallet approval sheet is open force-stop SHIFT, then approve in the wallet and reopen SHIFT | Home shows **Your shift is running** (the chain is the truth); a second clock-in is refused | |
| S-3.8 | F7-early | On **Your shift is running** tap **End shift & withdraw** → read the confirmation → **Confirm: end shift** → approve | Confirmation says it returns about **0.0215 SOL** (budget 0.02 + deposit 0.00146304). After approval: "Shift ended". Wallet balance returns to ≈ start − 0.0044804 − network fees. Home shows **Start a shift** again | |
| S-3.9 | AC-3.3 | (Only if easy) Empty the wallet below the cost, e.g. try a 0.1 SOL budget with ~0.05 SOL | **Clock in is disabled** with "Not enough SOL" (the simulation guard is exercised in unit tests; on device you cannot reach it without a funds race) | |

### Please report back
Pass/fail for S-3.1 … S-3.9, the wallet balance **before / after clock-in / after end shift** (so I can check the cost arithmetic to the lamport), the explorer link or signature of the clock-in and of the end-shift transactions, device + Android version, and any red text verbatim.

---

## S-4 — Phase 5: reconcile, payslip, active screen (F5, F6; AC-5.1-5.3, AC-6.1, AC-6.2, AC-6.5)

**Build:** same as S-1/S-3 (`git pull`, `cd app`, `eas build --platform android --profile smoke`). Run this AFTER S-3. Because the crank is dry-run only, **no rounds are played** yet: a shift shows 0 of 46 rounds. That still exercises every screen and the rebuild-from-chain logic; the "rounds counting up" part is checked in the live crank test (AC-4.1) later.

**Best starting point:** the wallet from S-3 where you clocked in and ended the shift early. Its IN memo is on chain with no OUT, so the app should treat it as **Complete, not collected**.

| ID | AC | Step | Expected | Result |
|---|---|---|---|---|
| S-4.1 | AC-6.5, AC-5.3 | Open the app (wallet from S-3, shift already ended, 0 rounds played) | Home shows **Shift complete**, a sentence starting "You put in 0.0200 SOL. You got back …", and a **Clock out & collect** button. **No** amber "Clock out within 24 h…" notice: a 0-round shift has no unchecked round with rewards at stake (PRD v1.6) | |
| S-4.2 | F6 | Tap **Clock out & collect** (opens the Payslip) | Title "Payslip"; headline "You put in 0.0200 SOL. You got back 0.0200 SOL." (0 rounds were played: the whole budget came back); **Net loss −0.0044804 SOL** (the one-time setup; sign AND words shown); Details: Rounds worked 0 of 46, SOL played 0.00, Executor fees 0.00, Unspent budget returned 0.02, **One-time setup — not refundable 0.0044804 SOL**; "Network fees are not included."; **no** 24 h notice; a **Clock out & collect** card. (Do NOT tap confirm yet: that is S-5) | |
| S-4.3 | AC-5.1 | Force-stop the app, reopen | Home is painted from the saved copy within ~1 s, then refreshes; the numbers do not change | |
| S-4.4 | AC-6.1 | Send me the wallet address shown on Home (or copy it from your wallet). I run `scripts/payslip-check.ts` on it | My read of the raw Miner counters and memo ledger produces the same payslip numbers you see (to the lamport) | |
| S-4.5 | AC-5.2, E-12 | Airplane mode on, pull down to refresh on Home | An amber banner "Couldn't refresh. Showing your last saved view. Last updated HH:MM" and the same figures; no crash. Airplane off + pull to refresh: banner disappears | |
| S-4.6 | AC-6.2 | **Clear data** (Settings → Apps → SHIFT → Storage → Clear data) **or uninstall and reinstall**, reconnect your wallet | Home again shows **Shift complete** and the same payslip numbers as S-4.2. (The app rebuilt everything from the last 60 days of memos on chain.) | |
| S-4.7 | F5 | Start a new shift (0.02 SOL) and approve | **Your shift is running**: Rounds worked **0 of 46**, a progress bar with the words next to it, **Time left about 59 min**, Budget left 0.0200 SOL, "Returned by ORE so far (≈ live)" 0.00, ORE 0.0000. The earlier shift now appears under "Earlier shifts" on the Payslip screen | |
| S-4.8 | F5 | On the running shift, force-stop the app and reopen | Still **Your shift is running** (the chain is the truth); no duplicate shift | |
| S-4.9 | F5 | Pull to refresh; also leave the screen open ~1 minute | "Updated HH:MM:SS" changes (30 s foreground refresh); nothing refreshes while the app is in the background | |
| S-4.10 | F7 | **End shift & withdraw** → read the confirmation → confirm → approve | Covered in detail by **S-5.5**; here just check the screen ends on a PAID shift with no crash | |

### Please report back
Pass/fail for S-4.1 … S-4.10, the Payslip numbers you see (headline, net, setup line) and your wallet address for S-4.4. For S-4.6 tell me how long the rebuild took.

---

## S-5 — Phase 6: real clock-out (F7; AC-7.1-7.5, AC-6.5, AC-3.4-style reconcile)

**Build:** `git pull`, `cd app`, `eas build --platform android --profile smoke`. Run after S-4.1/S-4.2 on the wallet from S-3 (a 0-round **Complete** shift). "End shift & withdraw" and "Clock out & collect" are now the **same single transaction**.

| ID | AC | Step | Expected | Result |
|---|---|---|---|---|
| S-5.1 | AC-7.4, AC-6.5 | Payslip of the 0-round shift → **Clock out & collect** | A confirmation: "No rounds were played, so there is nothing to collect. This just records the shift as PAID (a small network fee applies)." No wallet prompt yet | |
| S-5.2 | AC-7.1, AC-7.4 | **Confirm: clock out** → approve in the wallet | The wallet shows ONE transaction with a **single Memo instruction** and nothing else (no ClaimORE, no checkpoint, no stop: all omitted because there is nothing to do). Status messages in order: Checking… / Checking the transaction… / Approve in your wallet… / Confirming… | |
| S-5.3 | AC-7.1 | Open the transaction on the explorer (link in your wallet) | Exactly one instruction: Memo `SHIFT1\|OUT\|` + the first 16 characters of your clock-in signature | |
| S-5.4 | AC-7.2, F6 | Back on the Payslip / Home | Title **Payslip — PAID**; Home says **No shift today** with a **Last payslip** button; balance down by only ONE network fee (~0.000005 SOL) | |
| S-5.5 | AC-7.3 | Start a new shift (0.02 SOL, defaults), approve. On **Your shift is running** tap **End shift & withdraw** | A confirmation: "This ends your shift and collects your rewards in ONE transaction. About 0.0200 SOL of unspent budget comes back to your wallet, plus the account deposit, and any ORE you have earned is paid out…" | |
| S-5.6 | AC-7.1, AC-7.2 | **Confirm: end shift** → approve | ONE transaction with TWO instructions: an **Ore** program call (the stop that closes the automation) and the **Memo** (OUT). Result: "Your shift was ended and your rewards collected." / PAID. Wallet balance goes UP by about 0.0200 + the automation deposit (0.00146304 at today's rent) minus one network fee | |
| S-5.7 | AC-7.2 | Explorer: your **Automation** account for this wallet | Closed / does not exist | |
| S-5.8 | F6 | Payslip of the second shift | **PAID**; 0 rounds; **Break-even** (setup 0: your Miner already existed); headline "You put in 0.0200 SOL. You got back 0.0200 SOL." | |
| S-5.9 | AC-7.5 | Look for any way to clock out the same shift again | None: no Clock out button on a PAID payslip | |
| S-5.10 | AC-6.2 | **Clear data**, reconnect | Both shifts rebuilt as **PAID** (the OUT memos are on chain) | |

*Not testable on device yet (needs the live crank, "go live"):* a shift with rounds played, an unchecked final round (the amber 24 h notice), ORE actually claimed, and the Checkpoint look-ahead. Those are covered by unit tests and by read-only mainnet simulation of the transaction shapes (ClaimORE + close + memo; memo-only).

### Please report back
Pass/fail for S-5.1 … S-5.10, both transaction signatures (the memo-only OUT and the end-shift one), and your wallet balance before/after each.
