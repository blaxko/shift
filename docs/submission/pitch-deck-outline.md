# SHIFT — pitch deck outline (8 slides) with speaker notes

**Audience:** hackathon judges. The official CLOCK IN judging criteria (solanamobile.com blog) are *stickiness and product-market fit, user experience, innovation, presentation and demo*. Each slide below says which criterion it earns.
**Length:** about 4 minutes spoken (30 seconds a slide), designed to sit beside the 3-minute demo video, not repeat it.
**Rule for this deck:** every number is either measured by us (source named) or marked **[VERIFY]**. Anything marked **[FILL]** must come from the live test results before presenting. Do not present a claim from the "must be true first" list at the bottom until it is.

---

## Slide 1 — Problem
**On the slide:** *"A crypto phone with no daily reason to use it."* One image: the ORE grid screen on the left, a stack of wallet-signing prompts on the right.
- ORE mining asks you to watch a 5×5 grid, choose squares and **sign every round** (a round is about 78 seconds).
- On a phone the wallet session drops when the app is backgrounded; apps that depend on it lose state.
- Seeker owners hold the hardware and the interest, but nothing pulls them back every day.

**Speaker notes (30 s):** "ORE is the most active mining game on Solana and a large share of it already happens on Seeker. But it's built for a laptop: you babysit a grid and approve a transaction every minute and a quarter. On a phone that's the wrong ritual. People try it, bounce, and the phone goes back to being a phone. SHIFT asks: what if you only signed twice a day?"
**Earns:** stickiness / product-market fit.

## Slide 2 — Research
**On the slide:** three columns: *Who*, *What fails today*, *What we measured*.
- **Who [VERIFY before presenting; from our project brief, not independently re-checked]:** 200K+ Seekers shipped, 800+ dApp Store apps, 25%+ of ORE mining on Seeker.
- **What fails:** manual play needs attention every round; third-party automining works but is raw (no ritual, unclear results); other Seeker apps reviewed describe crashes on reopen and lost wallet sessions **[VERIFY: cite the reviews you read]**.
- **What we measured on mainnet (2026-10-04..06, all reproducible with scripts in the repo):** a round cycle is **78.3 s** (53 consecutive rounds, `scripts/measure-rounds.ts`); **260** automations exist and **40** funded ones already use a "permissionless executor" mode, so the primitive we build on is real and in use; the program's deployed bytecode is **verified against the exact source commit** we read (`48c203bd`, OtterSec); ORE changed the chain's rent between two days of our build, which is why SHIFT reads rent live and never hard-codes it.
- **The falsifiable bet:** testers complete ≥ 4 shifts in their first 7 days and ≥ 80 % of started shifts end with a clock-out.

**Speaker notes (30 s):** "We didn't guess the protocol. We read the program source, verified the deployed bytecode matches it, and measured real rounds. That's why the app's numbers are right: it reads the chain instead of trusting a spec."
**Earns:** innovation (grounded integration), product-market fit.

## Slide 3 — Principles
**On the slide:** five short lines, each with a one-line proof.
1. **One signature to start, one to finish.** (Clock in = one transaction; clock out = one transaction.)
2. **Max loss before you sign.** (The budget is on the card in plain words; setup costs are itemised as *refundable* or *not refundable*.)
3. **The chain is the truth, the phone is a cache.** (Payslip is rebuilt from on-chain data after a force-kill or a reinstall.)
4. **Never hold keys, never overspend.** (All signing is in the wallet; the deposit equals the displayed budget, hard-capped at 0.5 SOL, reload always off — enforced in code and re-checked on the exact bytes before the wallet opens.)
5. **No chasing.** (Smallest budget is the default; no "play again" or "win it back" copy.)

**Speaker notes (30 s):** "These are rules, not slogans — each one is a test in the repo. For example the pre-sign guard decodes the transaction we're about to hand the wallet and refuses it if the deposit differs from the number on screen by one lamport."
**Earns:** user experience, trust.

## Slide 4 — Demo
**On the slide:** a 3-minute video (or its poster frame) and a 4-step strip: *Clock in → Lock the phone → Payslip → Clock out*.
**Speaker notes (20 s + video):** "Here's a real shift on mainnet, filmed on a real phone. Watch two things: how few times the wallet opens, and what the payslip says after I force-kill the app."
**Earns:** presentation and demo, user experience.
**Production:** `demo-video-shot-list.md`.

## Slide 5 — Architecture
**On the slide:** one diagram, left to right:
`Phone (Expo app) ⇄ Mobile Wallet Adapter ⇄ wallet (Seed Vault / MWA wallet)` ; `Phone → RPC → ORE program` ; `Crank (Node, Railway) → RPC → ORE program` ; `SHIFT memos in the user's own wallet history = the ledger`.
Callouts:
- **No custom on-chain program.** SHIFT uses ORE's own `Automate`; audit surface is ORE's, not ours.
- **`@shift/codec`:** account decoders and instruction builders tested against real mainnet account dumps and by read-only `simulateTransaction` against the live program.
- **The ledger is the user's own wallet history:** a `SHIFT1|IN|…` memo at clock-in carries the baselines; the payslip is *counter now − counter at clock-in*. No server database.
- **Stateless executor:** restart it any time; it re-derives everything from chain.

**Speaker notes (30 s):** "Three pieces: a phone app, a small executor, and ORE itself. There's no SHIFT contract and no SHIFT database — the ledger is memos in your own wallet history, so a reinstall rebuilds your payslips and your streak from the chain."
**Earns:** innovation, technical credibility.

## Slide 6 — Trust model
**On the slide:** a two-column table, *The executor can* / *The executor cannot*, then one honest footnote.
- **Can:** place bets for you at the amount and squares you chose (strategy is *Preferred*: squares are fixed on-chain, the executor cannot pick); collect a flat 1,000-lamport fee per round out of your budget; nothing beyond the deposit.
- **Cannot:** withdraw, claim your rewards, change settings, spend more than the deposit, touch the rest of your wallet.
- **Footnote (we found this by reading the source, and we say it plainly):** a `Checkpoint` can pay its caller up to 10,000 lamports (0.00001 SOL), the reserve *you* pre-paid, and only for a round left unchecked 12+ hours. A prompt executor collects nothing.
- **Enforced twice:** a test fails if the executor's source imports anything but Deploy and Checkpoint, and every transaction is checked at runtime before it is built (ORE + compute-budget only, executor the only signer).
- **Live mode is behind two switches**; the default is simulate-only and needs no secret key.

**Speaker notes (30 s):** "The part judges and users should care about: if our server is hacked or simply stops, what's the worst case? Your budget was already capped when you signed. The executor can't take it, can't claim, can't change anything. And if it stops, End shift & withdraw works without it."
**Earns:** innovation, trust, user experience. Link: `docs/TRUST_MODEL.md`.

## Slide 7 — Roadmap / ORE milestones
**On the slide:** three bands. Mark done vs next honestly.
- **Built:** wallet connect (MWA), shift setup with itemised costs, one-signature clock-in, executor crank, payslip rebuilt from chain, one-signature clock-out, timesheet/streak/PTO/probation. **[FILL: live-loop result: "N rounds, X % deployed, payslip matched the explorer"]**
- **Next (P1, weeks):** shift-end notification, shareable payslip card, in-app executor status ("paused — your funds are safe"), crank rebuilds the list of people it served from its own history so the *final* round is checkpointed even if you never reopen the app.
- **ORE milestones (from our PRD §12, post-hackathon):** crews and leaderboards; staking claimed ORE; more roles tuned from live round data. Also: publish to the Solana dApp Store.
- **Metric we will report:** shifts per user in week one; clock-out rate; signatures per day (target ≤ 2); crash-free sessions.

**Speaker notes (30 s):** "We built the whole loop and kept the scope honest: what's on the left works today. Next is polish that makes it a habit: a notification when your shift ends, a share card, and an in-app status for the executor. After the hackathon, the ORE-native features: crews and staking."
**Earns:** stickiness / product-market fit.

## Slide 8 — Team
**On the slide:** **[FILL: your name, one-line role, photo optional, contact/handle]** — "Solo builder: product, engineering, demo." Under it: "Built with Claude Code as an engineering partner under a written spec (PRD with IDs, tests mapped to every acceptance criterion)."
- Repo: `github.com/blaxko/shift` (public). 
- One sentence on why you: **[FILL: e.g. why Solana Mobile / ORE]**.

**Speaker notes (20 s):** "I'm one builder. What made that possible is a spec with numbered acceptance criteria and a test for each, so every claim in this deck traces to something the repo can show. Thank you — the repo and APK are linked."
**Earns:** presentation.

---

## Claims that must be TRUE before you present them (verify, then delete the line)
- [ ] "Filmed on a real phone on mainnet": the live loop (GO_LIVE_PLAN stages A–F) has been run.
- [ ] Any number on slide 7 marked [FILL].
- [ ] "Works with Seed Vault": only if the demo ran on a Seeker. The test device so far was a non-Seeker phone with Phantom over MWA. If that stays true, say **"Mobile Wallet Adapter (tested with Phantom; designed for Seed Vault)"**.
- [ ] Ecosystem numbers on slide 2 marked [VERIFY].
- [ ] "Share card", "notification", "executor status in the app" are **not built**: keep them on the Next band, never on Built.
- [ ] Anything about ORE-prize eligibility: the prize terms were not found publicly (see `submission-checklist.md`).

## Q&A cheat-sheet (likely judge questions → honest answers)
| Question | Answer |
|---|---|
| What if your server is hacked? | It can only place bets inside the budget you chose; it cannot withdraw, claim or change anything. Trust model slide + `docs/TRUST_MODEL.md`. |
| Why not just use ORE's own automation UI? | That is the engine we use. SHIFT adds the ritual: a capped, itemised start, a payslip that survives app kills, a one-signature finish and a streak. |
| Who pays the executor? | A flat 1,000 lamports per round from the budget (≤ 5 % of each round, enforced by the planner). With one user it is below the executor's own transaction cost; it scales with batching. |
| What if ORE changes its program? | Decoders check owner, discriminator and size; on a mismatch the app goes read-only and refuses to sign. |
| Can it lose more than the budget? | No. Deposit = displayed budget, ≤ 0.5 SOL, enforced in the builder and re-checked on the bytes before signing. The one-time ORE account setup is shown separately, labelled not refundable. |
| What about the final round's rewards? | Clock-out checkpoints it. ORE forfeits unchecked rewards after about a day, so the app says "clock out within 24 h" when that is at stake. A server-side sweep is on the roadmap. |
