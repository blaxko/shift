// F4 step 4: build the executor's transactions. AC-4.5 / NFR-S6 / FR-4.3: the ONLY instructions that can ever be built here
// are ORE Deploy and ORE Checkpoint (+ compute-budget settings for the priority fee, which move no funds).
import { ORE_PROGRAM_ID, checkpoint, executorDeploy } from '@shift/codec';
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { WorkItem } from './plan';

/** Deploy ≈ 25k CU, Checkpoint with rewards ≈ 55k CU (measured by simulation); budget 70k per item + 10k base. */
const CU_PER_ITEM = 70_000;
const CU_BASE = 10_000;
/** Legacy transaction wire limit is 1232 bytes; keep a little slack. */
const MAX_TX_BYTES = 1_200;
const SIZE_PROBE_BLOCKHASH = '11111111111111111111111111111111';

const DISC_CHECKPOINT = 2;
const DISC_DEPLOY = 6;

export interface Batch {
  items: WorkItem[];
  instructions: TransactionInstruction[];
}

export function buildInstructions(p: { executor: PublicKey; roundId: bigint; items: WorkItem[]; priorityFeeMicroLamports: number }): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: CU_BASE + CU_PER_ITEM * p.items.length })];
  if (p.priorityFeeMicroLamports > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.priorityFeeMicroLamports }));
  for (const it of p.items) {
    if (it.checkpointRoundId !== null) ixs.push(checkpoint({ signer: p.executor, authority: it.authority, roundId: it.checkpointRoundId }));
    ixs.push(executorDeploy({ executor: p.executor, authority: it.authority, roundId: p.roundId, amount: it.automation.amount, mask: it.automation.mask }));
  }
  assertCrankInstructions(ixs, p.executor);
  return ixs;
}

/**
 * Runtime enforcement of AC-4.5 on the instructions about to be signed (NFR-S6). Throws; nothing is sent.
 *  - programs: ORE or ComputeBudget only
 *  - ORE instructions: Deploy (6) or Checkpoint (2) only
 *  - the executor is the ONLY signer anywhere (a user key can never be requested)
 */
export function assertCrankInstructions(ixs: TransactionInstruction[], executor: PublicKey): void {
  for (const ix of ixs) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (ix.keys.length !== 0) throw new Error('compute-budget instruction must have no accounts');
      continue;
    }
    if (!ix.programId.equals(ORE_PROGRAM_ID)) throw new Error(`forbidden program ${ix.programId.toBase58()}`);
    const d = ix.data[0];
    if (d !== DISC_DEPLOY && d !== DISC_CHECKPOINT) throw new Error(`forbidden ORE instruction discriminator ${d}`);
    if (!ix.keys[0]?.pubkey.equals(executor) || !ix.keys[0].isSigner) throw new Error('executor must be the first (signing) account');
    if (ix.keys.slice(1).some((k) => k.isSigner)) throw new Error('only the executor may sign');
  }
}

export function serializedSize(executor: PublicKey, ixs: TransactionInstruction[]): number {
  const msg = new TransactionMessage({ payerKey: executor, recentBlockhash: SIZE_PROBE_BLOCKHASH, instructions: ixs }).compileToLegacyMessage();
  return new VersionedTransaction(msg).serialize().length;
}

/** Greedy packing in order: as many items per transaction as fit in the wire limit and `maxItemsPerTx`. */
export function packBatches(p: { executor: PublicKey; roundId: bigint; items: WorkItem[]; priorityFeeMicroLamports: number; maxItemsPerTx: number }): Batch[] {
  const batches: Batch[] = [];
  let cur: WorkItem[] = [];
  const build = (items: WorkItem[]) => buildInstructions({ executor: p.executor, roundId: p.roundId, items, priorityFeeMicroLamports: p.priorityFeeMicroLamports });
  for (const it of p.items) {
    const trial = [...cur, it];
    if (cur.length > 0 && (trial.length > p.maxItemsPerTx || serializedSize(p.executor, build(trial)) > MAX_TX_BYTES)) {
      batches.push({ items: cur, instructions: build(cur) });
      cur = [it];
    } else cur = trial;
  }
  if (cur.length) batches.push({ items: cur, instructions: build(cur) });
  return batches;
}

export const batchFor = (p: { executor: PublicKey; roundId: bigint; items: WorkItem[]; priorityFeeMicroLamports: number }): Batch => ({
  items: p.items,
  instructions: buildInstructions(p),
});

export function toTransaction(executor: PublicKey, blockhash: string, ixs: TransactionInstruction[]): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({ payerKey: executor, recentBlockhash: blockhash, instructions: ixs }).compileToLegacyMessage());
}
