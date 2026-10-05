// FR-3.1 / E-6 / AC-3.5 — what to do about an Automation account that already exists for this wallet. Pure.
import type { Automation } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';

export type ExistingAutomation =
  | { kind: 'none' }
  /** balance 0 AND executor == owner: an empty shell. Confirm, then close + new Automate in ONE tx (PRD v1.1 / OQ-4). */
  | { kind: 'idle-shell' }
  /** Anything else: never modified (E-6). */
  | { kind: 'blocked'; why: 'shift-active' | 'foreign' };

/** `crank` may be undefined until the executor key is configured; then no automation can be classed as a running SHIFT shift. */
export function classifyExisting(a: Automation | null, owner: PublicKey, crank?: PublicKey): ExistingAutomation {
  if (!a) return { kind: 'none' };
  if (a.balance === 0n && a.executor.equals(owner)) return { kind: 'idle-shell' };
  if (crank && a.executor.equals(crank)) return { kind: 'blocked', why: 'shift-active' };
  return { kind: 'blocked', why: 'foreign' };
}
