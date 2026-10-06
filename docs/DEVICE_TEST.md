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
