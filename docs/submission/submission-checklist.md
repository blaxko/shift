# SHIFT — submission checklist (CLOCK IN, Solana Mobile × Radiants)

Status key: ✅ done and verified · 🟡 partly / needs your action · ❌ not done · ❓ requirement not verified (could not find it in an official source; **check it yourself**).
Last updated 2026-10-06.

## 0. Deadline (CONFIRMED by the user from the official page)
- **Submissions due 9 Oct 2026 at 07:59 GMT+1 = 9 Oct 06:59 UTC** (the "October 8" on the page is the same moment in US time). Matches the PRD.
- Internal plan unchanged: feature freeze **8 Oct 18:00 UTC**; submit well before 9 Oct 06:59 UTC.
- [ ] The user will also check the cutoff on the upload form itself.

## 1. Functional APK
| Item | Status | Evidence / action |
|---|---|---|
| Android build installs and runs | ✅ (smoke build) | S-1 passed on a real phone (`docs/DEVICE_TEST.md`) |
| Final **release** APK from EAS with the live executor public key | 🟡 | `EXPO_PUBLIC_CRANK_PUBKEY` is in `app/eas.json` (smoke profile). Build the final APK **after** S-3..S-6 pass: `npm run android` is dev only; use the EAS profile in README |
| Size ≤ 60 MB (NFR-P4) | ❌ not measured | Check the downloaded APK size after the build; record it in PROGRESS.md |
| Cluster = mainnet in the submitted build | 🟡 | `CLUSTER` constant; confirm the built app shows **no DEVNET badge** |
| Install instructions for judges | ✅ | README: Play Protect "Install anyway" note |
| Where it is hosted | ❌ | Upload the APK to the submission form and/or a GitHub Release (a release asset is fine; **do not** put an API key in it: the RPC URL is baked into any Expo public env, so use a rate-limited, public-safe RPC key **[VERIFY: what RPC URL the build uses]**) |

## 2. Public GitHub repository
| Item | Status | Evidence |
|---|---|---|
| Public repo | ✅ | github.com/blaxko/shift (recreated; verified public, 34+ commits) |
| README (pitch, flow, status, repo map, build, sideload note) | ✅ | `README.md` |
| No secrets in tree or history | ✅ | `node scripts/secret-scan.mjs` CLEAN on full history; key files in `.gitignore` |
| Personal email not exposed | ✅ | all commits use the no-reply address (verified after the push) |
| Licence | ✅ | MIT (`LICENSE`, README badge) |
| Docs a judge can follow | ✅ | `docs/PRD.md`, `TRUST_MODEL.md`, `ORE_NOTES.md`, `PROGRESS.md` (ACs with verification method) |
| Final push contains the latest commit | 🟡 | Verify `git rev-parse HEAD` equals GitHub's `main` before submitting |

## 3. Demo video
| Item | Status | Evidence / action |
|---|---|---|
| Script and shot list | ✅ draft | `docs/submission/demo-video-shot-list.md` |
| Length requirement | ❓ | The official page names none that I could find; PRD plans ~3 min. **[VERIFY on the form: max length / file size / upload vs link]** |
| Footage | ❌ | Needs the live loop (stages A–F of `GO_LIVE_PLAN.md`) on the real phone; needs your explicit "go live" |
| Hosting | ❌ | Public YouTube/Loom link set to **public or unlisted** (check the form says which); test the link in a private window |

## 4. Pitch deck / short presentation
| Item | Status | Evidence / action |
|---|---|---|
| Outline + speaker notes | ✅ draft | `docs/submission/pitch-deck-outline.md` (8 slides) |
| Actual slides | ❌ | Build in Slides/Keynote/Canva; export PDF **[VERIFY: format the form accepts]** |
| Placeholders resolved | ❌ | **[FILL]** on slides 7 and 8; **[VERIFY]** ecosystem numbers on slide 2 |

## 5. Mobile Wallet Adapter / Solana Mobile Stack usage
| Item | Status | Evidence |
|---|---|---|
| Uses MWA for connect and signing | ✅ | `@wallet-ui/react-native-web3js` (wraps MWA); S-1 device test passed connect/sign/reconnect |
| Tested on a **Seeker** / Seed Vault | ❌ | Test device so far is a non-Seeker phone with Phantom. **Do not claim Seed Vault** unless you test on a Seeker. If you have access to one before the deadline, run S-1/S-3 on it |
| Whether the hackathon *requires* MWA or Seeker | ❓ | PRD §11 rules were not confirmed against an official page. **[VERIFY: read the official rules for any "must be Android / must use MWA / must be publishable to the dApp Store" line]** |
| dApp Store publication | 🟡 post-win | Package id placeholder `app.shift.seeker`; identity URI/icon are placeholders (OQ-6). Not required to submit unless the rules say so **[VERIFY]** |

## 6. ORE qualification
| Item | Status | Evidence / action |
|---|---|---|
| Real ORE integration (not a mock) | ✅ | Uses ORE's own `Automate`/`Deploy`/`Checkpoint`/`Claim*` on program `oreV3EG1…`; bytecode verified against source `48c203bd`; read-only mainnet simulations of every builder (`docs/ORE_NOTES.md` §10) |
| ORE matched-prize terms (official, supplied by the user) | ✅ known | ONE matched prize, only for the strongest qualifying ORE integration that places in the Clock In Top 10; it matches that project's placement prize ($30k for 1st … $5k for 6th–10th). ORE decides qualification at its sole discretion. Requirements below |
| Working, user-facing ORE integration live in the submitted product | 🟡 | Built; **needs the live mainnet loop** and a final APK pointing at the live executor |
| ORE is a core part of the product | ✅ | SHIFT is entirely a wrapper around ORE's automation; no other mining supported |
| Integration stays live and actively supported after the hackathon | ❌ commitment | Executor must keep running and funded (Railway, executor SOL); decide who/what pays for it and note it in the README |
| Milestone-based deliverables agreed with ORE after the hackathon (paid in stages) | ❌ post-hackathon | Roadmap slide 7 proposes candidates: shift-end notification, final-round sweep, crews/staking; to be agreed with ORE |
| Short progress updates incl. usage metrics | 🟡 | Metrics we can report: shifts per user in week one, clock-out rate, signatures per day, crash-free sessions. **The app has no analytics (by design); metrics must come from on-chain SHIFT memos** — a small script that counts `SHIFT1|IN` / `SHIFT1|OUT` memos would be needed (not built) |
| ORE meaningfully included in launches, demos, content, social | ❌ | Plan: every artefact (deck, video, README, posts) names ORE; video opens on ORE's grid |
| Evidence of ORE activity on mainnet | ❌ | Needs the live loop. After it: explorer links to the IN memo, the executor's Deploy txs, the OUT memo; save them in `docs/submission/evidence.md` |
| No contradiction with ORE's terms | ❓ | Check that permissionless-executor automation is fine under ORE's rules (it is a documented on-chain mode; 40 existing automations use it) |

## 7. Judging-criteria → evidence (weights unpublished: don't claim any)
| Criterion | Our evidence |
|---|---|
| Stickiness / product-market fit | Shift ritual, streak/PTO/timesheet (F9 built); falsifiable bet on slide 2; **no user data yet, so don't claim traction** |
| User experience | One signature in, one out; max-loss card; accessibility pass with measured contrast (29 tests); payslip survives force-kill |
| Innovation | Wraps ORE's automation as a ritual with no custom program; chain-as-ledger memos; two-layer enforced trust model |
| Presentation & demo | Deck + video above (not yet produced) |

## 8. Remaining blockers (in order)
1. [ ] Confirm the real deadline (section 0).
2. [ ] Railway crank deployed in dry-run; send me `/health`.
3. [ ] S-3 results (clock-in/out on device), then S-4, S-5, S-6.
4. [ ] Executor funded (~0.03 SOL), then your explicit **"go live"** → stages A–F (dry-run, live, 30-min liveness, run-to-zero).
5. [ ] Film the demo (shot list), build the final APK, make the slides.
6. [ ] Resolve every [VERIFY]/[FILL]/❓ in this file and the deck.
7. [ ] Submit at least **a few hours before** the deadline; screenshot the confirmation.
8. F8/F10/F11 remain paused; none is needed for submission, and the docs describe them as "Next".

## 9. Submission-day final checks
- [ ] `npm test` · `npm run typecheck` · `npm run lint` · `node scripts/secret-scan.mjs` all green/CLEAN on the commit you submit.
- [ ] Repo main == local HEAD; the README status section matches reality (no unbuilt feature listed as built).
- [ ] The APK link, video link and deck link each open in a private browser window.
- [ ] Executor has enough SOL and is still running (or intentionally stopped after judging: decide and note it in the README).
