# SHIFT trust model (NFR-S8)

Source: `regolith-labs/ore` @ `48c203bd` (ore-api 3.8.25), the commit OtterSec reports as the deployed program. Citations are `file:line` in that commit. Draft written in Phase 1 for the Checkpoint review (decision 2); finalised in Phase 8.

## What the crank holds and sends
The crank holds one key (the executor) and enough SOL for network fees. It sends **only `Deploy` and `Checkpoint`** (FR-4.3), plus ComputeBudget settings that take no accounts and move no funds (the priority fee). It contains no code to transfer, claim, withdraw or close user funds; this is enforced by a test over its source and, at runtime, by `assertCrankInstructions` (programs limited to ORE + ComputeBudget, ORE instructions limited to Deploy and Checkpoint, executor the only signer). It is dry-run by default and in dry-run never even loads the secret key.

**Known limitation (OQ-7):** once ORE closes a depleted automation, the crank can no longer find that user (it discovers users through the automation's executor field), so the **final round's** `Checkpoint` is not sent by the crank. The user's clock-out includes it. ORE forfeits an unchecked round's rewards after about a day (`checkpoint.rs:52-57`), and ORE pays a bounty (the 10 000-lamport reserve) to anyone who checkpoints a round that has been unchecked for 12 hours or more (`checkpoint.rs:64-66`), so third-party bots are economically encouraged to do it, but this is not guaranteed.

## Every lamport movement the executor can trigger

### `Deploy` (signer = executor; `deploy.rs:73-77` requires `automation.executor == signer`)
| Line | Movement | Destination | Bound |
|---|---|---|---|
| `deploy.rs:346` | `total_amount` automation → Round PDA | the game (this *is* the shift) | `automation.amount × squares` per round, from the **user's** Automation account for `Preferred` (`deploy.rs:98-108`); never more than `automation.balance` (`deploy.rs:267-278`) |
| `deploy.rs:347` | `automation_fee` automation → **executor** | executor | `automation.fee` (user-set in `Automate`; 1 000 lamports in SHIFT), first deploy of a round only (`deploy.rs:338-342`) |
| `deploy.rs:274` | `estimated_fee` automation → **executor**, then `deploy.rs:275` close → **authority** | executor / user | one fee, only when balance can't cover a round; remainder + rent go to the user |
| `deploy.rs:351` | close automation → **authority** | user | refund of everything left |
| `deploy.rs:329` | `CHECKPOINT_FEE` **signer(executor) → miner** | user's Miner PDA | paid *by the executor*, not the user |

The executor cannot change amount, mask, strategy, fee, executor or reload (only the authority can: `automate.rs:113-119`). SHIFT always uses `Preferred`, so the executor cannot choose squares (`Discretionary*` would let it, `deploy.rs:201-207`).

### `Checkpoint` (permissionless: any signer; `checkpoint.rs:15`)
Accounts are bound to the user: `miner` must be the PDA of `authority_info` and `miner.authority == authority_info.key` (`checkpoint.rs:21-24`); `automation` must be the PDA for that same authority (`checkpoint.rs:17`). A caller cannot substitute someone else's authority to redirect rewards. All lamport transfers in the instruction:

| Line | Movement | Destination | Condition |
|---|---|---|---|
| `checkpoint.rs:203` | rewards, Round PDA → **user's Automation** | user | `automation.reload > 0` — SHIFT forces reload = 0 (NFR-S4), so unused |
| `checkpoint.rs:212` | rewards, Round PDA → **user's wallet** (`authority_info`) | user | `miner.auto_return > 0` (set to 1 on miner creation, `automate.rs:76`) — the normal SHIFT path |
| `checkpoint.rs:217` | rewards, Round PDA → **user's Miner** | user | `auto_return == 0` |
| `checkpoint.rs:223` | `bot_fee = miner.checkpoint_fee`, **user's Miner → signer** | **whoever calls Checkpoint** | only when `clock.slot >= round.expires_at - 12h` (`checkpoint.rs:64-66`), i.e. ≥ 12 h after the round ended |

**Finding (differs from the assumption "Checkpoint can't pay anyone but the user"):** the last row pays the *caller*. It is the program's checkpoint bounty: the user pre-pays `CHECKPOINT_FEE` = 10 000 lamports (0.00001 SOL) into their Miner once (`automate.rs:136-140`, `consts.rs:89`), and it is released to a checkpointer only for rounds that have gone unchecked for 12+ hours (`checkpoint.rs:64-66`). It then resets to 0 (`checkpoint.rs:66`), so it is paid at most once per refill. The SHIFT crank checkpoints promptly (the round just ended), so it falls in the < 12 h branch and **collects nothing**; this is asserted by a planned crank test. Worst case if the crank were instead delayed ≥ 12 h: it could take ≤ 10 000 lamports that the user had set aside for exactly that purpose. No other lamport can reach a non-user account via `Checkpoint`. Rewards themselves are paid from the Round PDA, not from the user's balance.

## What an attacker with the executor key can do
- Burn the shift budget **at the user's chosen rate and squares** (that's the product), never exceeding the deposit; stop deploying (user's funds stay in the program; the user can close at any time).
- Skip checkpointing → rewards for a round are forfeited if not checkpointed within one day (`checkpoint.rs:52-57`). This is a liveness loss, not a theft; the user (or any bot) can checkpoint, and SHIFT's clock-out includes a Checkpoint when needed.
- Earn at most `fee` per round (1 000 lamports) plus, in the 12 h-late case above, ≤ 10 000 lamports once.

It cannot touch the user's wallet balance, claim rewards (`claim_sol.rs:13,18`, `claim_ore.rs:66,71` require the authority), or change the automation.

## What the user signs
- **Clock-in:** `Automate` (deposit ≤ 0.5 SOL = displayed budget, reload 0) + memo. Rent for the Automation account (refunded at close) and for the Miner (only if new; not refunded) and the 10 000-lamport checkpoint reserve (not refunded) are paid in addition and shown on the review card. Rent is read live from the chain (it is a cluster parameter that changes; 1 463 040 and 4 470 400 lamports on 2026-10-06).
- **Clock-out:** Checkpoint (if needed) + ClaimORE (+ ClaimSOL only if > 0) + close (if still open) + OUT memo.
