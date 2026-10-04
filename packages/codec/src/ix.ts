import { PublicKey, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  DENOMINATOR_BPS,
  ENTROPY_PROGRAM_ID,
  ENTROPY_VAR_ADDRESS,
  MAX_DEPOSIT_LAMPORTS,
  MEMO_PROGRAM_ID,
  ORE_MINT,
  ORE_PROGRAM_ID,
  PERMISSIONLESS_EXECUTOR,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TREASURY_ADDRESS,
} from './constants';
import { MEMO_MAX_BYTES } from './memo';
import { pdas } from './pdas';

// Instruction layouts: docs/ORE_NOTES.md §3-4 (ore-api 3.8.25 @ 48c203bd).
// data = [discriminator u8] ++ little-endian struct bytes (steel macros.rs:198-204).

/** Thrown when a SHIFT safety invariant (NFR-S3 / NFR-S4 / strategy / executor) would be violated. Nothing is built. */
export class InvariantViolation extends Error {
  constructor(
    public readonly rule: string,
    detail: string,
  ) {
    super(`${rule}: ${detail}`);
    this.name = 'InvariantViolation';
  }
}

const DISC = { automate: 0, checkpoint: 2, claimSol: 3, claimOre: 4, deploy: 6 } as const;
const STRATEGY_PREFERRED = 1; // automation.rs:240-247
const U64_MAX = 0xffffffffffffffffn;
const MASK_ALL_25 = (1n << 25n) - 1n;

const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });

class Bytes {
  private parts: number[] = [];
  u8(n: number) {
    this.parts.push(n);
    return this;
  }
  u16(n: number) {
    this.parts.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }
  u32(n: number) {
    for (let i = 0; i < 4; i++) this.parts.push((n >>> (8 * i)) & 0xff);
    return this;
  }
  u64(n: bigint) {
    if (n < 0n || n > U64_MAX) throw new RangeError(`u64 out of range: ${n}`);
    for (let i = 0n; i < 8n; i++) this.parts.push(Number((n >> (8n * i)) & 0xffn));
    return this;
  }
  raw(b: Uint8Array) {
    this.parts.push(...b);
    return this;
  }
  done() {
    return Buffer.from(this.parts);
  }
}

/** AutomationConditions defaults = what the V1 fallback and every live automation use (automation.rs:255-266, 269-278). */
function defaultConditions(): Uint8Array {
  // max_production_cost u64::MAX | min_motherlode 0 | max_motherlode u16::MAX | split_tiles 0 | solo_tiles 0 | buffer 0
  return new Bytes().u64(U64_MAX).u16(0).u16(0xffff).u16(0).u16(0).u64(0n).done();
}

function encodeAutomate(p: { amount: bigint; deposit: bigint; fee: bigint; mask: bigint; strategy: number }): Buffer {
  // AutomateV2 (instruction.rs:61-71): amount, deposit, fee, mask, strategy u8, reload u64 (always 0), conditions[24].
  return new Bytes()
    .u8(DISC.automate)
    .u64(p.amount)
    .u64(p.deposit)
    .u64(p.fee)
    .u64(p.mask)
    .u8(p.strategy)
    .u64(0n) // reload — NFR-S4: hard-wired off, there is no parameter for it
    .raw(defaultConditions())
    .done();
}

function automateAccounts(authority: PublicKey, executor: PublicKey): AccountMeta[] {
  // automate.rs:41 [signer, automation, executor, miner, system_program]
  return [ws(authority), w(pdas.automation(authority)), w(executor), w(pdas.miner(authority)), r(SYSTEM_PROGRAM_ID)];
}

export interface AutomateParams {
  authority: PublicKey;
  /** The SHIFT crank key. */
  executor: PublicKey;
  /** Lamports per square per round. */
  amount: bigint;
  /** Lamports moved into the automation. NFR-S3: must equal the displayed budget, <= 0.5 SOL. */
  deposit: bigint;
  /** Flat executor fee per round, lamports. */
  fee: bigint;
  /** 25-bit square mask. */
  mask: bigint;
  /** NFR-S4: the only accepted value is `false`. Kept in the signature so a caller cannot forget the rule. */
  reload: false;
}

/**
 * ORE `Automate` for a SHIFT clock-in. Strategy is always Preferred (executor cannot choose squares) and reload is
 * always 0. Throws InvariantViolation instead of building anything unsafe (NFR-S3, NFR-S4).
 */
export function automate(p: AutomateParams): TransactionInstruction {
  if ((p.reload as boolean) !== false) throw new InvariantViolation('NFR-S4', 'reload must be false');
  if (p.deposit <= 0n) throw new InvariantViolation('NFR-S3', 'deposit must be > 0');
  if (p.deposit > MAX_DEPOSIT_LAMPORTS) throw new InvariantViolation('NFR-S3', `deposit ${p.deposit} exceeds 0.5 SOL cap`);
  if (p.amount <= 0n) throw new InvariantViolation('automate', 'amount per square must be > 0');
  if (p.mask <= 0n || (p.mask & ~MASK_ALL_25) !== 0n) throw new InvariantViolation('automate', 'mask must select 1..25 squares');
  if (p.executor.equals(PublicKey.default)) throw new InvariantViolation('automate', 'executor = default pubkey would close the automation');
  if (p.executor.equals(PERMISSIONLESS_EXECUTOR)) throw new InvariantViolation('automate', 'SHIFT uses its own executor, not the permissionless one');
  if (p.executor.equals(p.authority)) throw new InvariantViolation('automate', 'executor must not be the user');
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: automateAccounts(p.authority, p.executor),
    data: encodeAutomate({ amount: p.amount, deposit: p.deposit, fee: p.fee, mask: p.mask, strategy: STRATEGY_PREFERRED }),
  });
}

/**
 * Stop an automation: `Automate` with executor = Pubkey::default() (automate.rs:87-97). ORE closes the Automation account and
 * returns balance + rent to `authority`. All numeric fields are zero.
 */
export function stopAutomation(authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: automateAccounts(authority, PublicKey.default),
    data: encodeAutomate({ amount: 0n, deposit: 0n, fee: 0n, mask: 0n, strategy: 0 }),
  });
}

export interface ExecutorDeployParams {
  /** The crank key (signer). */
  executor: PublicKey;
  /** The user whose automation is being run. */
  authority: PublicKey;
  /** Board.round_id of the round being deployed into. */
  roundId: bigint;
  /** Ignored by ORE for Preferred automations (amounts come from the Automation account); pass automation.amount. */
  amount: bigint;
  /** Ignored by ORE for Preferred automations; pass automation.mask. */
  mask: bigint;
}

/** ORE `Deploy` as the executor. deploy.rs:17-21 (10 ORE accounts) + entropy var & program (deploy.rs:53-60). */
export function executorDeploy(p: ExecutorDeployParams): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      ws(p.executor),
      w(p.authority),
      w(pdas.automation(p.authority)),
      w(BOARD_ADDRESS),
      w(CONFIG_ADDRESS),
      w(pdas.miner(p.authority)),
      w(pdas.round(p.roundId)),
      w(TREASURY_ADDRESS),
      r(SYSTEM_PROGRAM_ID),
      r(ORE_PROGRAM_ID),
      w(ENTROPY_VAR_ADDRESS),
      r(ENTROPY_PROGRAM_ID),
    ],
    data: new Bytes().u8(DISC.deploy).u64(p.amount).u32(Number(p.mask & 0xffffffffn)).done(),
  });
}

/**
 * ORE `Checkpoint` (permissionless). checkpoint.rs:10 [signer, authority, automation, board, miner, round, treasury, system].
 * `roundId` = the Miner's `round_id` (the round being settled).
 */
export function checkpoint(p: { signer: PublicKey; authority: PublicKey; roundId: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      ws(p.signer),
      w(p.authority),
      w(pdas.automation(p.authority)),
      w(BOARD_ADDRESS),
      w(pdas.miner(p.authority)),
      w(pdas.round(p.roundId)),
      w(TREASURY_ADDRESS),
      r(SYSTEM_PROGRAM_ID),
    ],
    data: new Bytes().u8(DISC.checkpoint).done(),
  });
}

/** ORE `ClaimSOL`. claim_sol.rs:10 [signer, board, miner, system_program, ore_program]. Only include if miner.rewardsSol > 0. */
export function claimSol(authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [ws(authority), w(BOARD_ADDRESS), w(pdas.miner(authority)), r(SYSTEM_PROGRAM_ID), r(ORE_PROGRAM_ID)],
    data: new Bytes().u8(DISC.claimSol).done(),
  });
}

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/**
 * ORE `ClaimORE`. claim_ore.rs:61 [signer, board, miner, mint, recipient_ata, treasury, treasury_ata, system, token, ata_program, ore_program].
 * bps defaults to 10 000 (everything: refined + unrefined; a 10% fee applies to the unrefined part, miner.rs:90-99).
 */
export function claimOre(authority: PublicKey, bps: bigint = DENOMINATOR_BPS): TransactionInstruction {
  if (bps <= 0n || bps > DENOMINATOR_BPS) throw new RangeError('bps must be 1..10000');
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      ws(authority),
      w(BOARD_ADDRESS),
      w(pdas.miner(authority)),
      w(ORE_MINT),
      w(associatedTokenAddress(authority, ORE_MINT)),
      w(TREASURY_ADDRESS),
      w(associatedTokenAddress(TREASURY_ADDRESS, ORE_MINT)),
      r(SYSTEM_PROGRAM_ID),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(ORE_PROGRAM_ID),
    ],
    data: new Bytes().u8(DISC.claimOre).u64(bps).done(),
  });
}

/** SPL Memo v2 instruction signed by `signer` (so the memo is attributed to, and found via, the user's wallet history). */
export function shiftMemo(signer: PublicKey, text: string): TransactionInstruction {
  const data = Buffer.from(text, 'utf8');
  if (data.length === 0 || data.length > MEMO_MAX_BYTES) throw new RangeError(`memo must be 1..${MEMO_MAX_BYTES} bytes`);
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: signer, isSigner: true, isWritable: false }], data });
}
