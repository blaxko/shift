// F3 — build the clock-in transaction and guard it before it ever reaches the wallet.
// FR-3.1, AC-3.1, AC-3.5, NFR-S2, NFR-S3, NFR-S4. Pure.
import {
  InvariantViolation,
  MAX_DEPOSIT_LAMPORTS,
  MEMO_PROGRAM_ID,
  ORE_PROGRAM_ID,
  automate,
  formatInMemo,
  parseMemo,
  pdas,
  shiftMemo,
  stopAutomation,
} from '@shift/codec';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { WalletChainState } from './chainState';
import type { ExistingAutomation } from './conflict';
import { appError, type AppError } from './errors';
import type { ShiftPlan } from './planShift';

export interface ClockInBuildInput {
  owner: PublicKey;
  /** The SHIFT executor (public key only). */
  crank: PublicKey;
  plan: ShiftPlan;
  chain: WalletChainState;
  existing: ExistingAutomation;
  /** Non-refundable one-off costs about to be paid (costBreakdown().setupLamports). Recorded in the IN memo. */
  setupLamports: bigint;
  /** Local calendar date, YYYY-MM-DD, and minutes east of UTC. */
  localDate: string;
  tzOffsetMin: number;
}

export interface ClockInTx {
  instructions: TransactionInstruction[];
  memo: string;
}

/**
 * [stopAutomation (only for an idle shell)] -> automate -> IN memo, all in ONE transaction (AC-3.1, PRD v1.1 FR-3.1).
 * Throws instead of building anything when the wallet already has a non-idle automation (AC-3.5 / E-6).
 */
export function buildClockInInstructions(i: ClockInBuildInput): ClockInTx {
  if (i.existing.kind === 'blocked') {
    throw new InvariantViolation('FR-3.1', `existing ORE automation (${i.existing.why}) must not be modified`);
  }
  const { plan, chain } = i;
  const memo = formatInMemo({
    role: plan.role,
    budget: plan.budgetLamports,
    perSquare: plan.perSquareLamports,
    squares: plan.squares,
    feePerRound: plan.feePerRoundLamports,
    setupLamports: i.setupLamports,
    // Baselines (ORE_NOTES §7.2/7.5): the payslip is "counter now minus counter at clock-in".
    baseLifeSol: chain.miner?.lifetimeRewardsSol ?? 0n,
    baseLifeDeployed: chain.miner?.lifetimeDeployed ?? 0n,
    baseOre: chain.miner ? chain.miner.rewardsOre + chain.miner.refinedOre : 0n,
    localDate: i.localDate,
    tzOffsetMin: i.tzOffsetMin,
  });
  const instructions: TransactionInstruction[] = [];
  if (i.existing.kind === 'idle-shell') instructions.push(stopAutomation(i.owner));
  instructions.push(
    automate({
      authority: i.owner,
      executor: i.crank,
      amount: plan.perSquareLamports,
      deposit: plan.budgetLamports, // NFR-S3: exactly the displayed budget
      fee: plan.feePerRoundLamports,
      mask: plan.mask,
      reload: false, // NFR-S4
    }),
    shiftMemo(i.owner, memo),
  );
  return { instructions, memo };
}

const u64At = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);

/**
 * Defence in depth (NFR-S2/S3/S4): decode the instructions that are about to be signed and refuse anything that is not
 * exactly the reviewed shape. Runs on the real built instructions, not on the plan, so a bug in a builder or a tampered
 * list cannot slip through.
 */
export function assertClockInInvariants(ixs: TransactionInstruction[], p: { owner: PublicKey; crank: PublicKey; plan: ShiftPlan }): void {
  const { owner, crank, plan } = p;
  const bad = (rule: string, detail: string): never => {
    throw new InvariantViolation(rule, detail);
  };
  if (ixs.length < 2 || ixs.length > 3) bad('AC-3.1', `expected 2-3 instructions, got ${ixs.length}`);

  const ore = ixs.filter((ix) => ix.programId.equals(ORE_PROGRAM_ID));
  const memos = ixs.filter((ix) => ix.programId.equals(MEMO_PROGRAM_ID));
  if (ore.length + memos.length !== ixs.length) bad('NFR-S2', 'transaction contains an instruction for an unexpected program');
  if (memos.length !== 1) bad('AC-3.1', 'exactly one SHIFT memo instruction required');
  if (ixs[ixs.length - 1] !== memos[0]) bad('AC-3.1', 'memo must be the last instruction');

  const stops = ore.filter((ix) => ix.keys[2]?.pubkey.equals(PublicKey.default));
  const automates = ore.filter((ix) => !ix.keys[2]?.pubkey.equals(PublicKey.default));
  if (automates.length !== 1) bad('AC-3.1', 'exactly one Automate (deposit) instruction required');
  if (stops.length > 1) bad('AC-3.5', 'at most one stop instruction');
  if (stops.length === 1 && ixs[0] !== stops[0]) bad('AC-3.5', 'stop must come first');

  for (const s of stops) {
    // A stop moves no funds out of the user's control: all numeric fields zero, signed by the owner, own PDAs only.
    if (s.data.length !== 66 || s.data[0] !== 0 || s.data.subarray(1, 33).some((b) => b !== 0)) bad('AC-3.5', 'malformed stop instruction');
    if (!s.keys[0]!.pubkey.equals(owner) || !s.keys[1]!.pubkey.equals(pdas.automation(owner))) bad('AC-3.5', 'stop targets someone else');
  }

  const a = automates[0]!;
  const d = a.data;
  if (d.length !== 66 || d[0] !== 0) bad('AC-3.1', 'Automate data is not the expected 66-byte AutomateV2');
  if (!a.keys[0]!.pubkey.equals(owner) || !a.keys[0]!.isSigner) bad('NFR-S1', 'Automate must be signed by the connected wallet');
  if (!a.keys[1]!.pubkey.equals(pdas.automation(owner)) || !a.keys[3]!.pubkey.equals(pdas.miner(owner))) bad('NFR-S2', 'Automate accounts are not the wallet\'s own PDAs');
  if (!a.keys[2]!.pubkey.equals(crank)) bad('NFR-S2', 'Automate executor is not the SHIFT executor');

  const amount = u64At(d, 1);
  const deposit = u64At(d, 9);
  const fee = u64At(d, 17);
  const mask = u64At(d, 25);
  const strategy = d[33]!;
  const reload = u64At(d, 34);
  if (deposit !== plan.budgetLamports) bad('NFR-S3', `deposit ${deposit} != displayed budget ${plan.budgetLamports}`);
  if (deposit > MAX_DEPOSIT_LAMPORTS) bad('NFR-S3', 'deposit exceeds 0.5 SOL');
  if (reload !== 0n) bad('NFR-S4', 'reload must be 0');
  if (strategy !== 1) bad('NFR-S2', 'strategy must be Preferred');
  if (amount !== plan.perSquareLamports || fee !== plan.feePerRoundLamports || mask !== plan.mask) bad('NFR-S2', 'amount / fee / mask differ from the reviewed plan');

  const m = parseMemo(memos[0]!.data.toString('utf8'));
  if (!m || m.kind !== 'IN') bad('AC-3.1', 'memo is not a valid SHIFT IN memo');
  else if (m.budget !== plan.budgetLamports || m.perSquare !== plan.perSquareLamports || m.squares !== plan.squares || m.role !== plan.role) bad('AC-3.1', 'memo does not match the plan');
  if (!memos[0]!.keys.every((k) => k.pubkey.equals(owner) && k.isSigner)) bad('NFR-S2', 'memo may only be signed by the wallet');
}

/** The early end-shift transaction must be exactly one stop instruction for the connected wallet's own automation. */
export function assertEndShiftInvariants(ixs: TransactionInstruction[], owner: PublicKey): void {
  const bad = (detail: string): never => {
    throw new InvariantViolation('AC-3.5', detail);
  };
  if (ixs.length !== 1) bad('end shift is exactly one instruction');
  const s = ixs[0]!;
  if (!s.programId.equals(ORE_PROGRAM_ID) || s.data.length !== 66 || s.data[0] !== 0 || s.data.subarray(1, 33).some((b) => b !== 0)) bad('not a zeroed stop instruction');
  if (!s.keys[2]!.pubkey.equals(PublicKey.default)) bad('stop must use the default executor');
  if (!s.keys[0]!.pubkey.equals(owner) || !s.keys[0]!.isSigner || !s.keys[1]!.pubkey.equals(pdas.automation(owner))) bad('stop must target the connected wallet own automation');
}

/** AC-3.3: turn a failed simulation into a readable, typed error (never raw RPC text; that goes in `detail`). */
export function describeSimError(err: unknown, logs: string[] | null | undefined): AppError {
  const detail = JSON.stringify({ err, logs: (logs ?? []).slice(-6) });
  const e = err as Record<string, unknown> | string | null;
  const ic = typeof e === 'object' && e && 'InstructionError' in e ? (e.InstructionError as [number, unknown]) : null;
  const custom = ic && typeof ic[1] === 'object' && ic[1] && 'Custom' in (ic[1] as object) ? Number((ic[1] as { Custom: number }).Custom) : null;
  const ORE_ERRORS: Record<number, string> = { 0: 'ORE says the amount is too small.', 1: 'ORE says this wallet is not authorized for that automation.', 2: 'ORE rejected the executor.' };

  let msg = 'The transaction would fail, so your wallet was not opened. Nothing was sent.';
  if (e === 'AccountNotFound') msg = 'Your wallet has no SOL on this network, so the transaction cannot be paid for. Nothing was sent.';
  else if (e === 'InsufficientFundsForFee') msg = 'Not enough SOL to pay the network fee. Nothing was sent.';
  else if (e === 'BlockhashNotFound') msg = 'The network was slow to respond. Please try again. Nothing was sent.';
  else if (typeof e === 'object' && e && 'InsufficientFundsForRent' in e) msg = 'Not enough SOL to keep the new ORE accounts alive (rent). Add SOL and try again. Nothing was sent.';
  else if (custom !== null && ORE_ERRORS[custom]) msg = `${ORE_ERRORS[custom]} Nothing was sent.`;
  else if ((logs ?? []).some((l) => /insufficient lamports/i.test(l))) msg = 'Not enough SOL for this shift. Add SOL and try again. Nothing was sent.';
  return appError('SIMULATION_FAILED', msg, detail);
}
