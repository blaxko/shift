# ORE integration notes (PRD §9.4) — Phase 0.4

**Status:** APPROVED by user 2026-10-04 (ore-api 3.8.25 @ 48c203bd).

## 0. Pin

| Item | Value |
|---|---|
| Repo | `https://github.com/regolith-labs/ore` |
| Commit | `48c203bd75db3cc45105ec29d8f8db719e5a2263` ("no cli", 2026-10-02) |
| Crate version | workspace `3.8.25` (`Cargo.toml:5`); `ore-api` inherits it (`api/Cargo.toml:4`) |
| Framework | `steel` 4.0.9 (`Cargo.toml:42`, `Cargo.lock:2630`) |
| **On-chain match** | OtterSec verify API (`verify.osec.io/status/oreV3EG1…`, read 2026-10-04) reports `is_verified: true`, `commit: 48c203bd…`, i.e. **the deployed program is built from exactly this commit**. |

Path citations below are relative to that commit. `steel` citations are to `steel-4.0.9/src/…` (crates.io tarball).

## 1. Program IDs and mint

| Name | Address | Source |
|---|---|---|
| ORE program | `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv` | `api/src/lib.rs:19` |
| ORE mint (11 decimals) | `oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp` | `api/src/consts.rs:71`, decimals `consts.rs:7` |
| Board (singleton, == PDA) | `BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi` | `consts.rs:110` |
| Treasury (singleton, == PDA) | `45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG` | `consts.rs:113` |
| Config (singleton, == PDA) | `9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy` | `consts.rs:116` |
| Permissionless-executor sentinel | `executor11111111111111111111111111111111112` | `consts.rs:80` |
| Memo v2 | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | PRD §3 F3 (SPL Memo; not ORE source) |

Codec tests assert PDA(board/treasury/config) == these constants.

## 2. PDA seeds (all under the ORE program ID)

`api/src/state/mod.rs:344-370`, seed bytes `api/src/consts.rs:41-68`.

| Account | Seeds |
|---|---|
| Automation | `["automation", authority]` (`mod.rs:344`) |
| Miner | `["miner", authority]` (`mod.rs:360`) |
| Board | `["board"]` (`mod.rs:348`) |
| Round | `["round", id u64 LE]` (`mod.rs:364`) |
| Treasury | `["treasury"]` (`mod.rs:368`) |
| Config | `["config"]` (`mod.rs:356`) |

Verified against fixtures: every fixture automation/miner/round lives at the PDA derived from its own decoded authority/id (codec test).

## 3. Instruction encoding

`steel::instruction!` (`steel-4.0.9/src/macros.rs:187-206`): `data = [discriminator u8] ++ bytemuck::bytes_of(struct)`. All structs are `#[repr(C)]` with byte-array fields → little-endian, **no padding**.

Discriminators `api/src/instruction.rs:22-42`: `Automate=0, Checkpoint=2, ClaimSOL=3, ClaimORE=4, Close=5, Deploy=6, Log=8, Reset=9`. `OreInstructionV2::AutomateV2 = 0` (`instruction.rs:46-48`) shares discriminator 0.

**Automate vs AutomateV2 — distinguished by data length only.** `program/src/automate.rs:9-23` tries `AutomateV2::try_from_bytes` (exact length) then falls back to `Automate`.

| Struct | Fields (all LE) | Length incl. disc |
|---|---|---|
| `Automate` (`instruction.rs:50-59`) | amount u64, deposit u64, fee u64, mask u64, strategy u8, reload u64 | 1+41 = **42** |
| `AutomateV2` (`instruction.rs:61-71`) | the above + `conditions` 24 bytes | 1+65 = **66** |
| `ClaimSOL` (`instruction.rs:73-75`) | none | 1 |
| `ClaimORE` (`instruction.rs:77-81`) | bps u64 (`ClaimORE` with no body ⇒ 10 000, `claim_ore.rs:54-57`) | 1 or 9 |
| `Deploy` (`instruction.rs:83-88`) | amount u64, squares u32 mask | 13 |
| `Checkpoint`, `Close`, `Reset` | none | 1 |

`conditions` layout (`state/automation.rs:269-278`): `max_production_cost u64 | min_motherlode u16 | max_motherlode u16 | split_tiles u16 | solo_tiles u16 | _buffer u64`. Program default via V1 fallback: `max_production_cost = u64::MAX, min_motherlode 0, max_motherlode u16::MAX, split 0, solo 0` (`automation.rs:255-266`) — **identical to what all live automations hold** (fixtures: `ffffffffffffffff 0000 ffff 0000 0000 0000…`). The SDK's `automate()` emits V2 (`sdk.rs:27-60`). **Plan: emit V1 (42 bytes) with default conditions — fewer bytes, same result — or V2 with defaults; decide at Phase 1 (both byte-tested).**

`strategy` (`automation.rs:240-247`): `Random=0, Preferred=1, Discretionary=2, DiscretionaryBps=3`.

## 4. Ordered account lists

From the processors' destructuring (authoritative) — they match `api/src/sdk.rs`.

**Automate** (`automate.rs:41`, `sdk.rs:27-60`): `[signer(w,s), automation(w), executor(w), miner(w), system_program]`.

**Deploy** (executor path; `deploy.rs:17-21`, `sdk.rs:110-155`) — 10 ORE accounts + 2 entropy:
`[signer(w,s) = executor, authority(w), automation(w), board(w), config(w), miner(w), round(w), treasury(w), system_program, ore_program, entropy_var(w), entropy_program]`.
`entropy_var = entropy_api::state::var_pda(board, 0)` (`sdk.rs:123`) = `VAR_ADDRESS BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E` (`consts.rs`, grep `VAR_ADDRESS`); the entropy program is `3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X` (`entropy-api` 0.1.4 `src/lib.rs:17`; seed `"var"` at `src/consts.rs:2`; PDA `["var", board, 0u64 LE]` at `src/state/mod.rs:16-21` — reproduced in a codec test: it derives exactly `VAR_ADDRESS`). **Do not read `Config.protocol.entropy_var_address` / `entropy_program_id`:** on mainnet they hold different values (`5Jq6Nh…` / `1111…`, fixture `config-9c9X7aDR`) and `Deploy` never consults them — it checks `VAR_ADDRESS` and `entropy_api::ID` (`deploy.rs:57,60`). Entropy accounts are only *used* on the first deploy of a round (`deploy.rs:47-69`) but the SDK always passes them and so do we. Verified by simulation, see §10.
Data: `Deploy{amount, squares}`. For `Preferred`/`Random` strategy both are **ignored** — amount and mask come from the Automation account (`deploy.rs:98-108`); for `Discretionary*` the executor's mask/amount are used (`deploy.rs:201-207`).

**ClaimSOL** (`claim_sol.rs:10`, `sdk.rs:62-78`): `[signer(w,s), board(w), miner(w), system_program, ore_program]`.

**ClaimORE** (`claim_ore.rs:61`, `sdk.rs:80-108`): `[signer(w,s), board(w), miner(w), mint(w), recipient_ata(w), treasury(w), treasury_ata(w), system_program, token_program, associated_token_program, ore_program]`. `recipient_ata = ATA(signer, ORE mint)`; created by the program if empty, rent paid by signer (`claim_ore.rs:84-93`).

**Checkpoint** (`checkpoint.rs:10`, `sdk.rs:334-352`): `[signer(w,s), authority(w), automation(w), board(w), miner(w), round(w), treasury(w), system_program]`; `round = round_pda(miner.round_id)`. **Permissionless: any signer.**

**Stop / close an automation:** `Automate` with `executor_info.key == Pubkey::default()` — checks `a.authority == signer`, then `automation.close(signer)` and returns (`automate.rs:87-97`). Same account list as Automate with executor = `11111111111111111111111111111111`. The *entire* automation lamports (balance + rent) go to the authority (`close` sends all lamports to the target; same primitive as `deploy.rs:275`). Note the Miner is opened first if missing (`automate.rs:57-85`) — harmless for an existing user.
(`Close = 5` is **not** that: it closes expired *Round* accounts, `close.rs:6-41`.)

## 5. Account layouts

All accounts: 8-byte discriminator `[OreAccount as u8, 0×7]` (`state/mod.rs:333-342`; `steel macros.rs:44` SIZE = 8 + size_of) + `#[repr(C)]` Pod body, LE. Confirmed against live data (slot 453346683+):

| Account | disc | Size | Source | Verified live |
|---|---|---|---|---|
| Automation | 100 | **160** | `state/automation.rs:174-210` | 4 fixtures |
| Config | 101 | 232 | `state/config.rs` | 1 |
| Miner | 103 | **752** | `state/miner.rs:181-241` | 4 fixtures |
| Treasury | 104 | 48 | `state/treasury.rs` | 1 |
| Board | 105 | 40 | `state/board.rs:9-24` | 1 |
| Round | 109 | **952** | `state/round.rs:9-56` | 4 fixtures |

Automation offsets (after the 8-byte disc): `amount@8 u64, authority@16, balance@48, executor@56, fee@88, strategy@96, mask@104, reload@112, total_sol_spent@120, total_ore_earned@128, conditions@136 (24 bytes)`.
Executor `getProgramAccounts` memcmp offset (Q-1/FR-4 step 2): **offset 56, 32 bytes**, with `dataSize: 160`. Live count of automation-sized accounts at fetch time: **227** (cheap to scan every round).

Miner fields in order: `authority, auto_return, checkpoint_id, checkpoint_fee, deployed[25], mass[25], cumulative[25], round_id, rewards_factor (Numeric, 16B), rewards_sol, refined_ore, rewards_ore, last_claim_ore_at, last_claim_sol_at, lifetime_rewards_ore, lifetime_deployed, lifetime_rewards_sol`. Board: `round_id, start_slot, end_slot, production_cost_ema`. Full types: `packages/codec/src/decode.ts`.

The decoders reject wrong owner / size / discriminator with `LayoutMismatch` (E-11) — tested.

## 6. Executor permissions (feeds TRUST_MODEL, NFR-S8)

What an executor key **can** do on a user's automation (`deploy.rs:73-77`: `executor == signer || executor == EXECUTOR_ADDRESS`; `authority` must match):
1. Call `Deploy` for that authority once per round window; with `Preferred` strategy the **amount and square mask come from the user's Automation account**, not from the executor (`deploy.rs:98-108`).
2. Collect `automation.fee` lamports **once per round** (`min_fee`, `automation.rs:297-303`; charged only on the miner's first deploy of the round, `deploy.rs:338-347`). The fee is set by the user in `Automate`; the executor cannot raise it.
3. Trigger the automatic close when balance is too low: remaining balance (minus fee) is returned to the **authority**, not the executor (`deploy.rs:267-278, 349-351`).

What it **cannot** do: change amount/mask/strategy/fee/executor/reload (only `authority` can, `automate.rs:113-119`); withdraw or transfer the balance (SOL only moves to the Round PDA, the executor fee, or back to the authority: `deploy.rs:346-351`); claim rewards (claims require the authority as signer, `claim_sol.rs:13,18`, `claim_ore.rs:66,71`); spend more than `balance`. **Caveat:** with `Discretionary`/`DiscretionaryBps` the executor chooses squares — SHIFT must use `Preferred` (or `Random`) so it cannot (PRD says Preferred ✓).
Everyone, not just the executor, can `Checkpoint` (§7) — no authority needed.
Worst-case loss to the user from a malicious executor is bounded by `deposit` (it can burn it by deploying, which is the product), never the wallet. Wallet is only touched at Automate/Claim/Close, which the user signs.

## 7. Behaviours the PRD got wrong or didn't know (⚠ see OPEN_QUESTIONS)

1. **Checkpoint is mandatory between rounds.** `Deploy` panics (`assert!` "Miner has not checkpointed", `deploy.rs:251-256`) if `miner.checkpoint_id != miner.round_id` when a new round starts. Someone must send `Checkpoint` for the *previous* round before each deploy. The crank must do it (permissionless, no authority needed) — **conflicts with AC-4.5 / NFR-S6 / FR-4.3 as written** (OQ-2).
2. **SOL winnings are auto-returned to the wallet.** `Miner.auto_return = 1` on creation (`automate.rs:76`) and with `reload = 0`, checkpoint sends `rewards_sol` straight to `authority` and decrements `miner.rewards_sol` (`checkpoint.rs:194-215`). So `miner.rewards_sol` ≈ 0 (all 4 live miners show 0) and the PRD's "SOL won = miner.rewardsSol − baseline" is wrong. Correct counter: `lifetime_rewards_sol` (always incremented, `checkpoint.rs:178`). Note it is "SOL **returned**" — includes the ~90% back from losing squares, not just wins (`checkpoint.rs:148-153`). (OQ-3)
3. **The automation closes itself** when balance < one round's cost (`deploy.rs:267-278, 349-351`), refunding balance + rent to the wallet. So "Complete" ⇒ the Automation account usually **no longer exists**; `balanceRemaining` is not readable from chain after that; PRD §9.2 `Active→Complete: balance < perRoundCost`, AC-5.3, E-17 and AC-7.2 need rewording. Payslip must derive from `Miner` deltas (`lifetime_deployed`, `lifetime_rewards_sol`) + the memo baseline. (OQ-3)
4. **Fees are flat lamports per round**, not per square, not bps, for `Preferred` (Q-2). `Discretionary` flat; `DiscretionaryBps` is bps ≤ 1% (`docs/DISCRETIONARY_BPS.md`, `automate.rs:121-124`). Per-round cost = `amount × squares + fee`.
5. **ORE claim**: `ClaimORE{bps}` pays out `refined_ore + rewards_ore` × bps; **10% fee on the unrefined part** (`miner.rs:90-99`). `lifetime_rewards_ore` is *decremented* by that fee on claim (`miner.rs:98`), so it is not monotonic → not a clean "ORE earned" counter across a claim (OQ-3).
6. **Round timing** (Q-5): live Config `round_slots = 240`, `intermission_slots = 48` (fixture, slot 453346683); live Board `end−start = 240`. Slot time measured ≈ 0.27 s (getBlockTime over 2 900 slots) ⇒ a round window ≈ 65–72 s, full cycle (288 slots) ≈ 78–86 s — **not 60 s**. A round only starts on the first deploy after a Reset (`deploy.rs:47-69`); `Reset` is a separate permissionless instruction (`reset.rs`, needs `clock.slot >= end_slot + intermission_slots`, `reset.rs:28`) that *someone* must send. ORE-run bots do this today (rounds are advancing: board round 428 270). We must not assume; flag.
6a. **`ROUND_SECONDS = 78` (measured).** Method (`scripts/measure-rounds.ts`, read-only): `Round.expires_at = end_slot + ONE_DAY_SLOTS` (`deploy.rs:50`; `ONE_DAY_SLOTS` = 24×60×200 = 288 000, `consts.rs:26-35`), so each live Round account yields its `end_slot`. Cycle = difference of end slots of consecutive round ids (includes intermission, waiting for Reset and the first deploy). Slots→seconds from `getBlockTime` at the first and last end slot. Result on 2026-10-04 (current round 428 282; the 54 most recent *ended* rounds, 53 consecutive pairs): cycle slots min 289 / **p50 289** / mean 290.6 / p90 290 / max 341; 0.2694 s per slot; **p50 77.8 s, mean 78.3 s, p90 78.1 s**; wall-clock 4 149 s over the span = 78.3 s per round. So `ROUND_SECONDS = 78`; ORE's bots run `Reset` promptly (289 ≈ 240 + 48 + 1). It is a planning estimate only — runtime code reads the chain.
7. **No minimum deploy amount** exists in the program (`OreError::AmountTooSmall` is declared at `error.rs:7` but never raised; grep of `program/` and `api/` finds no use). PRD's `ORE_MIN_DEPLOY` therefore has to be a product constant (Q-5).
8. **Rent / one-off costs at Automate** (not in `deposit`): Automation account rent 2 004 480 lamports (matches live fixture lamports exactly; `(160+128)×6960`), Miner rent 6 124 800 lamports if the Miner doesn't exist yet (`(752+128)×6960`), plus `CHECKPOINT_FEE` 10 000 lamports into the Miner if `checkpoint_fee == 0` (`automate.rs:136-140`, `consts.rs:89`). Automation rent is refunded at close; Miner rent stays. ORE ATA rent (≈ 2 039 280) is paid at first `ClaimORE` if the user has no ORE token account.
9. **Existing-automation behaviour** (Q-6): one Automation PDA per authority (`mod.rs:344`). `Automate` on an existing one **overwrites its settings and adds `deposit`** (`automate.rs:112-134`) — so the FR-3.1 conflict check must read the PDA first; clock-in must never be sent over a foreign one. Live fixtures also contain **stale automations: balance 0, executor = authority** (2 of 4). Policy for those is an open question (OQ-4).
10. **Round expiry**: a round's rewards are forfeited if never checkpointed within `ONE_DAY_SLOTS` after it ends (`checkpoint.rs:52-57`; `expires_at = end_slot + ONE_DAY_SLOTS`, `deploy.rs:50`). A crank that checkpoints every round avoids this.
11. **Reload**: `reload = 0` ⇒ `automation.reload = 0` (`automate.rs:29,133`), and checkpoint then returns SOL to the wallet as above. NFR-S4 behaves as assumed.

12. **The 10 000-lamport checkpoint reserve and the Miner rent are NOT refundable to the user.** Trace of every use of `checkpoint_fee`: set once and collected from the *signer* into the Miner PDA at `Automate` when it is 0 (`automate.rs:137-139`) — likewise from the *executor* at `Deploy` when it is 0 (`deploy.rs:327-329`); released only by `Checkpoint` to the *caller* when a round is ≥ 12 h past its end (`checkpoint.rs:64-66,223`); required to remain in the Miner (`checkpoint.rs:229`). Every lamport outflow from the Miner PDA in the program: `checkpoint.rs:223` (bot fee, above) and `claim_sol.rs:28` (`rewards_sol` only). There is **no instruction that closes a Miner** (`grep miner_info.close` over `program/` is empty) and closing the *Automation* (`deploy.rs:275,351`, `automate.rs:95`) moves only the Automation's lamports. ⇒ At first clock-in the user pays Miner rent 6 124 800 + reserve 10 000 = **6 134 800 lamports (0.0061348 SOL) permanently** (the Miner is reused by later shifts, so later clock-ins cost 0 for these). If a bot has ever claimed the reserve, the next clock-in refunds it (10 000) and ORE's own `Deploy` makes the executor top it up if it is 0 at deploy time (`deploy.rs:327-329`) — a tiny crank cost (10 000 lamports) only in that case. Automation rent (2 004 480) *is* refunded at close.

## 8. Answers to PRD Q-1 … Q-7

| Q | Answer | Evidence |
|---|---|---|
| **Q-1** executor deploy instruction + accounts | `Deploy` (disc 6), signer = executor, accounts per §4; `Checkpoint` (disc 2) must precede the next round's deploy. With `Preferred`, the data amount/mask are ignored. | `deploy.rs:9-77,251-256`, `sdk.rs:110-155`, `checkpoint.rs:10-33` |
| **Q-2** fee semantics | Flat lamports **per round** (first deploy of the round), user-set in `Automate.fee`, paid from the automation balance to the executor signer. (bps only for `DiscretionaryBps`.) Break-even: crank cost per round is one tx fee (5 000 lamports base + priority) shared across the batch, so ~7 000 lamports flat (the value ORE's own bots use — `COMPOUND_FEE_PER_TRANSACTION`, live fixture fee = 7000) is plausible; **final fee is a product decision.** | `automation.rs:297-303`, `deploy.rs:338-347`, `consts.rs:92` |
| **Q-3** public ORE executor? | The protocol has a built-in *permissionless* mode: `executor = EXECUTOR_ADDRESS` lets **any** signer deploy for the automation (`deploy.rs:76`; not allowed with Discretionary strategies, `automate.rs:49-54`). One live fixture uses it (fee 7000, 702 M lamports spent). Whether a third-party bot will reliably serve a *new* automation isn't determinable from source. Also BURY_AUTHORITY `HNWhK5f…` is an executor on another live fixture (balance 1 413 000, fee 7000). Checkpoint is still needed. | `consts.rs:80,107`; fixtures `automation-5dV8F9Uj`, `-4dPdFJ7N` |
| **Q-4** stop & withdraw | `Automate` with executor = `Pubkey::default()` (`1111…`). Closes the account, returns balance + rent to authority in the same tx. | `automate.rs:87-97` |
| **Q-5** min deploy, round duration | No on-chain minimum. Round = 240 slots + 48 intermission (live Config), ≈ 78–86 s per cycle at ≈ 0.27 s/slot. Read `Config.protocol.round_slots/intermission_slots` at runtime rather than hardcoding. | §7.6–7.7, fixtures `config-9c9X7aDR`, `board-BrcSxdp1` |
| **Q-6** one automation per authority? | Yes — PDA `["automation", authority]`; E-6 conflict check = read that PDA. | `mod.rs:344`, `automate.rs:100-119` |
| **Q-7** reward fields; checkpoint before claim? | SOL: **`lifetime_rewards_sol` delta** (not `rewards_sol`, which is auto-returned to 0). ORE: pending = `rewards_ore` (unrefined) + `refined_ore`; claim pays both, 10% fee on unrefined. **Checkpoint is required before claim** to realise the last rounds' rewards, and between rounds for Deploy; crank handles the latter, the clock-out tx should include a `Checkpoint` for `miner.round_id` if `checkpoint_id != round_id`. | §7.2, §7.5, `claim_ore.rs:98-99`, `miner.rs:73-102`, `checkpoint.rs:30-33` |

## 9. Fixtures (read-only, `scripts/fetch-fixtures.ts`)

`packages/codec/test/fixtures/` — 4 automation, 4 miner, 4 round, 1 board, 1 treasury, 1 config; all recorded at slots 453346683–453346689 on 2026-10-04 (slot + date inside each file; RPC URL redacted). Decoder tests: 16 passing.

## 10. Builder verification by `simulateTransaction` (Phase 1; read-only, `scripts/simulate-live.ts`)

Run 2026-10-04 against mainnet, `sigVerify:false` (nothing signed or sent; keys not involved). A funded wallet pays fees; where a fixture wallet is empty, a *simulated* `SystemProgram.transfer` tops it up so it behaves like a user holding SOL.

| Case | Transaction | Result |
|---|---|---|
| A | idle shell owner (balance 0, executor == owner; fixture `automation-2fFYVW8S`): **`[stopAutomation, automate]` in one tx** | **OK.** Post-state of the Automation PDA: `balance = deposit`, `executor = crank`, `strategy = 1`, `reload = 0`, `amount`/`mask`/`fee` as sent. Proves OQ-4 decision (close + new Automate in ONE tx). Control: `automate` alone *overwrites* the shell (also OK on chain — which is why FR-3.1 gates it behind confirmation). |
| B | fresh wallet (no Automation/Miner): `[automate, memo]` | **OK**, 57 747 CU. Post-state matches AC-3.2 (balance == deposit, executor == crank, Preferred, reload off). Memo program logged the exact IN memo. |
| C | `claimOre`, `claimSol`, `checkpoint` for real miners | **OK** (claimSol logged "Claiming 0 SOL"). |
| D | `executorDeploy` as the real executor of a live automation (`4dPdFJ…`) | **ORE program ran Deploy to success** (`Round #… deploying … squares`) — so the 12-account list incl. entropy is right. The *transaction* then failed `InsufficientFundsForRent` on account index 3 = that fixture automation PDA itself: it is a legacy account holding 1 465 480 lamports (< 2 004 480 = rent for 160 bytes today), so any write that doesn't close it is rejected. Not a builder issue; to be re-confirmed on a SHIFT-created automation under `DRY_RUN=1` in Phase 4 (AC-4.4). |

Harness notes: Deploy only works inside a round's open window (`deploy.rs:33`); the script retries across the intermission and reads the Board at `processed` commitment (a `finalized` read lags and trips the round-PDA seed check at `deploy.rs:35`).
