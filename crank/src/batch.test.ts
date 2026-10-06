import { automate, claimOre, claimSol, shiftMemo, stopAutomation, ORE_PROGRAM_ID } from '@shift/codec';
import { ComputeBudgetProgram, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { assertCrankInstructions, buildInstructions, packBatches, serializedSize } from './batch';
import { automation, executor } from './crank.testkit';
import type { WorkItem } from './plan';

const item = (checkpointRoundId: bigint | null = null): WorkItem => {
  const a = automation();
  return { authority: a.authority, automation: a, checkpointRoundId };
};
const programs = (ixs: TransactionInstruction[]) => ixs.map((i) => i.programId.toBase58());

describe('buildInstructions', () => {
  it('compute budget first, then [Checkpoint?, Deploy] per item, in order', () => {
    const a = item(97n);
    const b = item(null);
    const ixs = buildInstructions({ executor, roundId: 100n, items: [a, b], priorityFeeMicroLamports: 1_000 });
    expect(programs(ixs)).toEqual([
      ComputeBudgetProgram.programId.toBase58(),
      ComputeBudgetProgram.programId.toBase58(),
      ORE_PROGRAM_ID.toBase58(), // checkpoint for a
      ORE_PROGRAM_ID.toBase58(), // deploy a
      ORE_PROGRAM_ID.toBase58(), // deploy b
    ]);
    expect(ixs[2]!.data[0]).toBe(2); // Checkpoint
    expect(ixs[3]!.data[0]).toBe(6); // Deploy
    expect(ixs[4]!.data[0]).toBe(6);
  });
  it('priority fee of 0 omits the price instruction', () => {
    const ixs = buildInstructions({ executor, roundId: 100n, items: [item()], priorityFeeMicroLamports: 0 });
    expect(ixs.filter((i) => i.programId.equals(ComputeBudgetProgram.programId))).toHaveLength(1);
  });
  it('the executor is the only signer on every ORE instruction', () => {
    for (const ix of buildInstructions({ executor, roundId: 100n, items: [item(5n), item()], priorityFeeMicroLamports: 10 })) {
      if (ix.programId.equals(ORE_PROGRAM_ID)) expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([executor.toBase58()]);
    }
  });
});

describe('assertCrankInstructions (AC-4.5 / NFR-S6 / FR-4.3, enforced at runtime)', () => {
  const user = Keypair.generate().publicKey;
  it('refuses every instruction that could move, claim, withdraw or close user funds', () => {
    const forbidden: TransactionInstruction[] = [
      SystemProgram.transfer({ fromPubkey: executor, toPubkey: user, lamports: 1 }),
      claimSol(user),
      claimOre(user),
      stopAutomation(user), // closes a user's automation
      automate({ authority: user, executor, amount: 1n, deposit: 1n, fee: 1n, mask: 1n, reload: false }),
      shiftMemo(executor, 'SHIFT1|OUT|abcdefghijkmnopq'),
    ];
    for (const ix of forbidden) expect(() => assertCrankInstructions([ix], executor), programs([ix])[0]).toThrow();
  });
  it('refuses an ORE instruction that is not signed by the executor, or asks a user to sign', () => {
    const ix = buildInstructions({ executor, roundId: 1n, items: [item()], priorityFeeMicroLamports: 0 })[1]!;
    const stranger = Keypair.generate().publicKey;
    expect(() => assertCrankInstructions([new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k, i) => (i === 0 ? { ...k, pubkey: stranger } : k)) })], executor)).toThrow(/executor/);
    expect(() => assertCrankInstructions([new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k, i) => (i === 1 ? { ...k, isSigner: true } : k)) })], executor)).toThrow(/only the executor/);
  });
  it('refuses a compute-budget instruction smuggling accounts', () => {
    const ix = new TransactionInstruction({ programId: ComputeBudgetProgram.programId, data: Buffer.from([2, 0, 0, 0, 0]), keys: [{ pubkey: executor, isSigner: true, isWritable: true }] });
    expect(() => assertCrankInstructions([ix], executor)).toThrow();
  });
  it('accepts exactly what the crank builds', () => {
    expect(() => buildInstructions({ executor, roundId: 100n, items: [item(3n), item()], priorityFeeMicroLamports: 1_000 })).not.toThrow();
  });
});

describe('packBatches (FR-4 step 4: batch as many as fit per transaction)', () => {
  const many = (n: number, cp: bigint | null = null) => Array.from({ length: n }, () => item(cp));
  const pack = (items: WorkItem[], max = 12) => packBatches({ executor, roundId: 100n, items, priorityFeeMicroLamports: 1_000, maxItemsPerTx: max });

  it('every batch fits the wire limit and every item appears exactly once, in order', () => {
    const items = many(40, 7n); // worst case: every item also needs a checkpoint
    const batches = pack(items);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(serializedSize(executor, b.instructions)).toBeLessThanOrEqual(1_232);
    expect(batches.flatMap((b) => b.items)).toEqual(items);
  });
  it('respects maxItemsPerTx', () => {
    const batches = pack(many(7), 3);
    expect(batches.map((b) => b.items.length)).toEqual([3, 3, 1]);
  });
  it('packs several deploys into one transaction when they fit', () => {
    expect(pack(many(3), 12)).toHaveLength(1);
  });
  it('a single item always gets its own batch (never dropped)', () => {
    expect(pack(many(1))).toHaveLength(1);
    expect(pack([])).toEqual([]);
  });
  it('each batch passes the AC-4.5 guard and checkpoints precede their own deploy', () => {
    for (const b of pack([item(5n), item(null), item(6n)])) {
      expect(() => assertCrankInstructions(b.instructions, executor)).not.toThrow();
      b.instructions.forEach((ix, i) => {
        if (ix.programId.equals(ORE_PROGRAM_ID) && ix.data[0] === 2) expect(b.instructions[i + 1]!.data[0]).toBe(6);
      });
    }
  });
});
