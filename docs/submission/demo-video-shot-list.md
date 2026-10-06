# SHIFT — 3-minute demo video shot list (mapped to PRD §15)

Target length 3:00 (the hackathon names no length; the PRD plans about 3 minutes). Six segments, 23 shots. For **every shot** this file says what must be on screen and **what state the app and the wallet must be in beforehand**, because a demo like this is won or lost in preparation, not in the edit.

**Honest constraints that change the script (read first)**
1. **The share card (PRD §15 2:10–2:40) is not built** (F10 is paused). This list replaces it with the streak/timesheet and a verification beat. Do not show or mention a share card.
2. **PTO** needs a real skipped day in your history. Unless you really have shifts on non-adjacent days, show PTO as the *tested logic* (shot 5c) instead of faking chain data.
3. **"40 minutes later" must be real.** One live 1-hour shift (GO_LIVE_PLAN) is filmed in pieces: shots 2–3 at the start, shot 4 at about +40 minutes, shots 5–6 at the end.
4. **Wallet approval screens may record as black** (wallets often set a secure flag that blocks screen capture). Film those moments with a second phone/camera (shots marked 📷) and cut them in.
5. **Device:** the tested phone so far is not a Seeker and the wallet is Phantom over MWA. Say "Mobile Wallet Adapter" and name the wallet you actually use. Say "Seed Vault" only if you film on a Seeker.
6. Nothing here can be shot until: S-3 passed, the Railway crank is deployed, you have said "go live", and the live loop works (`docs/GO_LIVE_PLAN.md`).

---

## Production setup (once, before any shot)
| Item | Setting |
|---|---|
| Phone | Do Not Disturb on, battery ≥ 80 %, status-bar notifications cleared, brightness high, **light theme** (better contrast on video), system font scale default |
| Screen capture | Android's built-in screen recorder (or `scrcpy --record`), 1080p, with "record audio" off (voice-over is separate). Keep each shot as its own file |
| Second camera | Another phone on a stand for 📷 shots: wallet approval and the phone being locked/force-killed |
| Wallet | Phantom (or Seed Vault on a Seeker) with the test wallet **funded ≥ 0.06 SOL**; no other apps' pending requests; **hide balances you don't want public** |
| App build | The release APK you will submit (profile `smoke`/`release`), freshly installed, wallet **not yet connected** for shot 2 |
| Executor | Railway crank **LIVE** and `/health` showing `"mode":"LIVE"`, `"ok":true`, executor balance ≥ 0.01 SOL |
| Browser tab(s) | Solana explorer on the laptop (or phone) with your wallet address ready |
| Voice-over | Record last, from a script, in a quiet room; keep each segment's words to the time budget below |

---

## Segment 1 — 0:00–0:25 · Problem (the ORE grid + repeated signing)
| # | Time | On screen | Required state | Voice-over (≈) |
|---|---|---|---|---|
| 1a | 0:00–0:10 | Screen recording of ORE's own grid UI (ore.com) mid-round, a countdown, squares being picked | Any ORE session with **a wallet you do not mind showing** (or a pre-recorded clip). No real balances on screen | "ORE is the biggest mining game on Solana. It asks you to watch a grid and pick squares every round." |
| 1b | 0:10–0:20 | 📷 Phone in hand; wallet approval sheet popping up again and again (cut 3 times in a row) | A wallet connected to a dApp that will prompt repeatedly (stage it, or use a quick staged montage) | "…and to sign a transaction every minute and a quarter. On a phone, that's the wrong ritual." |
| 1c | 0:20–0:25 | Title card: **SHIFT** + tagline "Clock in once. ORE works your shift." | — | "SHIFT: clock in once." |

## Segment 2 — 0:25–1:00 · Setup, "max loss", sign once
| # | Time | On screen | Required state | Voice-over |
|---|---|---|---|---|
| 2a | 0:25–0:32 | Welcome screen → tap **Connect wallet** → wallet sheet → approve → Home | App freshly installed, wallet **not** connected, MWA wallet installed. 📷 for the wallet sheet if it blacks out | "I connect my wallet once through Mobile Wallet Adapter." |
| 2b | 0:32–0:42 | Home → **Start a shift** → Balanced / 0.0200 SOL / 1 h → scroll to the **review card**. Hold on **"Max you can lose: 0.0200 SOL"** and the itemised list with *Refundable / Not refundable* labels | Wallet balance ≥ 0.06 SOL so no "Not enough SOL" banner. **Existing Miner** (from earlier tests) so the card shows only budget, automation deposit, fees. If you want the setup lines on screen, use a fresh wallet instead | "Before I sign anything the app shows the most I can lose — and every cost is labelled refundable or not." |
| 2c | 0:42–0:55 | **Clock in** → confirm screen → **Confirm and sign** → 📷 wallet approval sheet showing ONE transaction → "Confirming on the network…" → **Your shift is running**: 0 of 46 rounds | Executor LIVE (so rounds start counting right after). Phone has data/Wi-Fi | "One signature. That's the only time I'll open my wallet until the shift is over." |
| 2d | 0:55–1:00 | Quick cut: browser/explorer on the clock-in transaction: two instructions, **Ore** and **Memo** `SHIFT1\|IN\|balanced\|20000000\|…` | Have the explorer link ready from the app's "View the clock-in transaction" button | "The start of my shift is recorded on-chain in my own wallet history." |

## Segment 3 — 1:00–1:30 · Force-kill, lock, "40 minutes later"
| # | Time | On screen | Required state | Voice-over |
|---|---|---|---|---|
| 3a | 1:00–1:08 | 📷 Recents screen: swipe SHIFT away (force-kill). Then press power: phone locks | Shift running with the executor live | "Now I do what real life does: I kill the app and lock the phone." |
| 3b | 1:08–1:18 | Full-screen title card "40 minutes later" over a timelapse of the Railway logs scrolling `batch_sent` lines (screen-record the logs during the real wait) | **Record the Railway logs for real during the wait** so the timelapse is genuine | "While I'm away, a small executor places each round's bet — only at the amount and squares I chose." |
| 3c | 1:18–1:30 | `/health` JSON in the phone's browser (or laptop) showing `"mode":"LIVE"`, `"activeAutomations":1`, a recent `lastRoundDeployedAt` | Same live executor | "It can't withdraw, can't claim, can't change my shift. Its only power is placing those bets." |

## Segment 4 — 1:30–2:10 · Reopen: the payslip rebuilds; clock out with one signature
| # | Time | On screen | Required state | Voice-over |
|---|---|---|---|---|
| 4a | 1:30–1:40 | Unlock → open SHIFT (cold start, no splash tricks) → Home shows **Your shift is running** with e.g. **"31 of 46 rounds · about 20 min left"** | Film at about **+40 min** of the real shift; the app was force-killed at least 30 min earlier; app data NOT cleared | "I reopen the app that I killed. It didn't remember anything — it rebuilt my shift from the chain." |
| 4b | 1:40–1:52 | **View my shift**: progress bar, "Returned by ORE so far (≈ live)", "ORE earned so far (≈ live)". Split-screen with the **explorer** showing the miner/automation (or a terminal running `npx tsx scripts/payslip-check.ts <wallet>`) with the **same numbers** | Run `payslip-check` at the same moment so the numbers match to the lamport (this is AC-6.1). Pick the moment between rounds so numbers don't change mid-shot | "Same numbers, read independently. The payslip is correct after a force-kill because the phone is only a cache." |
| 4c | 1:52–2:10 | Payslip: headline "You put in 0.0200 SOL. You got back …", **Net loss/gain with sign and label**. Tap **End shift & withdraw** (or, if you wait the extra 20 min, **Clock out & collect**) → confirmation text → **Confirm** → 📷 wallet shows ONE transaction → "Shift ended… PAID" | If ending early: the confirmation states the unspent budget returned. If waiting for Complete: the amber "Clock out within 24 h…" notice should be visible first (a good beat) and the transaction has Checkpoint + ClaimORE + memo | "Finishing is one signature too: it settles my last round, collects my ORE and closes the shift." |

*Option for 4c:* the full-length path (shift runs to zero, then **Clock out & collect**) shows the best story (Complete state, 24 h notice, ClaimORE) but needs about 20 more real minutes; film it as a separate take and cut with a "20 minutes later" card.

## Segment 5 — 2:10–2:40 · Timesheet, streak, PTO (the share card is NOT built)
| # | Time | On screen | Required state | Voice-over |
|---|---|---|---|---|
| 5a | 2:10–2:20 | **Home streak card** ("Streak: N days", "One free day off (PTO) available this week", "Probation: n/5 shifts") → **Timesheet** calendar with ✓ marks | The wallet has ≥ 1 shift on the current day (it will). A multi-day streak only exists if you really started shifts on earlier days (Oct 6, 7, 8): plan your real clock-ins accordingly | "Every shift is a mark on my timesheet. Miss a day and a free day off covers it, once a week." |
| 5b | 2:20–2:30 | Payslip history: tap an earlier shift → its payslip (PAID) | At least two shifts in history (your S-3/S-5 test shifts count) | "Every payslip is rebuilt from my wallet's own history." |
| 5c | 2:30–2:40 | Terminal: `npm test` scrolling to the streak/PTO tests green, or the `streak.test.ts` file open on "two missed days in one ISO week break the streak" | `npm test` passing (it does) | "The streak logic is a pure function with tests for the awkward cases: time zones, month ends, PTO." |

## Segment 6 — 2:40–3:00 · Trust model + architecture; the closing line
| # | Time | On screen | Required state | Voice-over |
|---|---|---|---|---|
| 6a | 2:40–2:50 | Slide: the architecture diagram (deck slide 5), then the trust table (slide 6) | Deck finished | "No custom contract and no SHIFT database: the ledger is memos in my own wallet. The executor can bet inside my budget — nothing else." |
| 6b | 2:50–3:00 | Back to the phone, locked, a hand picking it up; end card: "SHIFT needed me once." + repo URL `github.com/blaxko/shift` | — | "SHIFT needed me once. Clock in; ORE does the rest." |

---

## Shooting order (what to film when, from one real shift)
1. **T0** (start of the live run): shots 2a–2d (+3a). Start the Railway-logs screen recording.
2. **T0 + ~40 min:** shots 4a–4b (cold start, payslip vs explorer/`payslip-check`).
3. **T0 + ~62 min** (shift Complete): optional full-length 4c variant with the 24 h notice and the clock-out with Checkpoint + ClaimORE.
4. Any time: 1a–1c (problem), 3c (`/health`), 5a–5c (streak/timesheet), 6a–6b.
5. Record voice-over last; cut to 2:55–3:00.

## Checks before you export
- [ ] No private data on screen: wallet address shown only abbreviated (the app abbreviates it), no RPC URL or API key visible in any log or browser bar, **no `executor.json`, no Railway variable values** (blur the Railway page if it shows variables).
- [ ] Every number spoken matches what is on screen at that moment.
- [ ] You never claim a feature that is not built (share card, notification, in-app executor status).
- [ ] "Mobile Wallet Adapter" is named; "Seed Vault" only if filmed on a Seeker.
- [ ] Audio levels even; no copyrighted music (or royalty-free only).
- [ ] Final length ≤ 3:05; exported at 1080p; file size is accepted by the submission form **[VERIFY the form's limit]**.

## Fallbacks if something goes wrong on the day
| Problem | Fallback |
|---|---|
| Wallet sheet records black | 📷 second-camera shot; or film the explorer result and cut to "transaction confirmed" |
| Live executor misses a round before the take | Do not edit it out silently: re-run the take, or say "a round was skipped; the payslip still reconciles" |
| Phone dies / app crashes mid-take | That is the product: reopen and show the payslip, a better shot than the original |
| No time for a full 60-minute shift | Film shots 2 and 3 live, then use the shift started earlier for shot 4 (clearly timestamped on the explorer), and say "from an earlier shift" |
