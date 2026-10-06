// F4 steps 1-3: which automations get deployed THIS round, and which need a Checkpoint first. Pure.
// Source for every rule: docs/ORE_NOTES.md §4/§7 (deploy.rs / checkpoint.rs @ 48c203bd).
import type { Automation, Board, Miner } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';

export const U64_MAX = 0xffffffffffffffffn;
/** automation.rs:240-247. The crank only ever runs SHIFT's strategy; Discretionary* would let the executor pick squares. */
export const STRATEGY_PREFERRED = 1n;

export function popcount(mask: bigint): number {
  let n = 0;
  for (let m = mask & 0x1ffffffn; m > 0n; m >>= 1n) if (m & 1n) n++;
  return n;
}

/** Cost of one round for this automation: amount × squares + flat fee (deploy.rs:268-273, 338-347). */
export const roundCost = (a: Automation): bigint => a.amount * BigInt(popcount(a.mask)) + a.fee;

/**
 * Deploy is valid when slot ∈ [start, end) (deploy.rs:33). After Reset, end_slot == u64::MAX means "waiting": the first
 * Deploy starts the round (deploy.rs:47-50), so that state is OPEN. We stop `endMarginSlots` early: a tx that lands after
 * the window just fails.
 */
export function windowOpen(board: Board, slot: bigint, endMarginSlots: bigint): boolean {
  if (slot < board.startSlot) return false;
  if (board.endSlot === U64_MAX) return true;
  return slot + endMarginSlots < board.endSlot;
}

export type SkipReason = 'not-preferred' | 'bad-params' | 'insufficient-balance' | 'no-miner' | 'already-deployed';

export interface WorkItem {
  authority: PublicKey;
  automation: Automation;
  /** Set when ORE requires a Checkpoint of the miner's previous round before this deploy (deploy.rs:251-256). */
  checkpointRoundId: bigint | null;
}

export interface RoundPlan {
  roundId: bigint;
  items: WorkItem[];
  skipped: { authority: string; reason: SkipReason }[];
  /** Automations we COULD run (right strategy, funded for a round), whether or not this round still needs them. */
  activeCount: number;
}

export function planRound(p: {
  board: Board;
  automations: Automation[];
  /** keyed by authority base58; null = the account does not exist */
  miners: Map<string, Miner | null>;
  executor: PublicKey;
}): RoundPlan {
  const { board } = p;
  const items: WorkItem[] = [];
  const skipped: RoundPlan['skipped'] = [];
  let active = 0;

  for (const a of p.automations) {
    const who = a.authority.toBase58();
    // Defence in depth: the chain filter already selects executor == us.
    if (!a.executor.equals(p.executor)) continue;
    if (a.strategy !== STRATEGY_PREFERRED) {
      skipped.push({ authority: who, reason: 'not-preferred' });
      continue;
    }
    if (a.amount <= 0n || popcount(a.mask) === 0) {
      skipped.push({ authority: who, reason: 'bad-params' });
      continue;
    }
    // AC-4.2: below one round's cost ORE closes the automation itself; we simply stop (no error, no tx).
    if (a.balance < roundCost(a)) {
      skipped.push({ authority: who, reason: 'insufficient-balance' });
      continue;
    }
    active++;

    const miner = p.miners.get(who) ?? null;
    // Deploy would CREATE a missing Miner at the executor's expense (deploy.rs:218-226). Automate always creates it, so
    // a missing one is anomalous: never pay for it.
    if (!miner) {
      skipped.push({ authority: who, reason: 'no-miner' });
      continue;
    }

    let checkpointRoundId: bigint | null = null;
    if (miner.roundId === board.roundId) {
      // The miner was already rolled into this round by a deploy. Done if it actually deployed something.
      if (miner.deployed.reduce((s, x) => s + x, 0n) > 0n) {
        skipped.push({ authority: who, reason: 'already-deployed' });
        continue;
      }
    } else if (miner.checkpointId !== miner.roundId) {
      checkpointRoundId = miner.roundId; // settle the previous round first
    }
    items.push({ authority: a.authority, automation: a, checkpointRoundId });
  }
  return { roundId: board.roundId, items, skipped, activeCount: active };
}
