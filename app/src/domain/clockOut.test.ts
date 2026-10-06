import type { Automation, Miner } from '@shift/codec';
import { InvariantViolation, MEMO_PROGRAM_ID, ORE_PROGRAM_ID, claimOre, claimSol, formatOutMemo, parseMemo, pdas, shiftMemo, stopAutomation, checkpoint, automate } from '@shift/codec';
import { Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { assertClockOutInvariants, buildClockOutInstructions, planClockOut, type ClockOutPlan } from './clockOut';
import { FUNDED_FOREIGN, REAL_MINER, crank, owner } from './chainFixtures.testkit';

const IN_SIG = '3Y' + 'a'.repeat(86);
const minerWith = (over: Record<string, unknown>): Miner => ({ ...REAL_MINER, authority: owner, checkpointId: 100n, roundId: 100n, rewardsOre: 0n, refinedOre: 0n, rewardsSol: 0n, ...over });
const ours = { ...FUNDED_FOREIGN, authority: owner, executor: crank };
const plan = (over: Partial<ReturnType<typeof args>> = {}) => planClockOut({ ...args(), ...over });
const args = (): { miner: Miner | null; settled: Miner | null; automation: Automation | null; owner: typeof owner; crank: typeof crank | undefined } => ({ miner: minerWith({}), settled: minerWith({}), automation: null, owner, crank });

describe('planClockOut (AC-7.1, AC-7.4): omit what has nothing to do', () => {
  it('THE S-3 CASE: 0-round shift, nothing unchecked, nothing to claim, automation already closed -> memo only', () => {
    expect(plan({ miner: minerWith({ roundId: 0n, checkpointId: 0n }), settled: minerWith({ roundId: 0n, checkpointId: 0n }) })).toEqual({ checkpointRoundId: null, claimOre: false, claimSol: false, closeAutomation: false });
  });
  it('checkpoint only when the miner has an unchecked round', () => {
    expect(plan({ miner: minerWith({ roundId: 102n, checkpointId: 101n }) }).checkpointRoundId).toBe(102n);
    expect(plan({ miner: minerWith({ roundId: 102n, checkpointId: 102n }) }).checkpointRoundId).toBeNull();
    expect(plan({ miner: null, settled: null }).checkpointRoundId).toBeNull();
  });
  it('ClaimORE only if refined + unrefined > 0 AFTER the checkpoint (the settled miner), not before', () => {
    const before = minerWith({ roundId: 102n, checkpointId: 101n, rewardsOre: 0n });
    expect(plan({ miner: before, settled: before }).claimOre).toBe(false);
    expect(plan({ miner: before, settled: minerWith({ rewardsOre: 5n }) }).claimOre).toBe(true); // credited by the checkpoint
    expect(plan({ settled: minerWith({ refinedOre: 1n }) }).claimOre).toBe(true);
  });
  it('ClaimSOL only if rewardsSol > 0 (with auto-return it is normally 0)', () => {
    expect(plan({ settled: minerWith({ rewardsSol: 0n }) }).claimSol).toBe(false);
    expect(plan({ settled: minerWith({ rewardsSol: 1n }) }).claimSol).toBe(true);
  });
  it('closes ONLY SHIFT\'s own automation (executor == crank); a foreign or absent one is never touched', () => {
    expect(plan({ automation: ours }).closeAutomation).toBe(true);
    expect(plan({ automation: { ...FUNDED_FOREIGN, authority: owner } }).closeAutomation).toBe(false);
    expect(plan({ automation: null }).closeAutomation).toBe(false);
    expect(plan({ automation: ours, crank: undefined }).closeAutomation).toBe(false);
    expect(plan({ automation: { ...ours, authority: Keypair.generate().publicKey } }).closeAutomation).toBe(false);
  });
});

describe('buildClockOutInstructions: order and shape', () => {
  const full: ClockOutPlan = { checkpointRoundId: 101n, claimOre: true, claimSol: true, closeAutomation: true };
  const kinds = (p: ClockOutPlan) =>
    buildClockOutInstructions({ owner, plan: p, inSignature: IN_SIG }).instructions.map((ix) => (ix.programId.equals(MEMO_PROGRAM_ID) ? 'memo' : ix.data[0] === 2 ? 'checkpoint' : ix.data[0] === 4 ? 'claimOre' : ix.data[0] === 3 ? 'claimSol' : 'stop'));

  it('everything: Checkpoint -> ClaimORE -> ClaimSOL -> close -> OUT memo, one transaction', () => {
    expect(kinds(full)).toEqual(['checkpoint', 'claimOre', 'claimSol', 'stop', 'memo']);
  });
  it('each part is independently omitted', () => {
    expect(kinds({ ...full, checkpointRoundId: null })).toEqual(['claimOre', 'claimSol', 'stop', 'memo']);
    expect(kinds({ ...full, claimOre: false })).toEqual(['checkpoint', 'claimSol', 'stop', 'memo']);
    expect(kinds({ ...full, claimSol: false })).toEqual(['checkpoint', 'claimOre', 'stop', 'memo']);
    expect(kinds({ ...full, closeAutomation: false })).toEqual(['checkpoint', 'claimOre', 'claimSol', 'memo']);
    expect(kinds({ checkpointRoundId: null, claimOre: false, claimSol: false, closeAutomation: false })).toEqual(['memo']);
  });
  it('the OUT memo points at the IN signature prefix and parses', () => {
    const { memo } = buildClockOutInstructions({ owner, plan: full, inSignature: IN_SIG });
    expect(parseMemo(memo)).toEqual({ kind: 'OUT', inSigPrefix: IN_SIG.slice(0, 16) });
    expect(memo).toBe(formatOutMemo({ inSigPrefix: IN_SIG.slice(0, 16) }));
  });
  it('every built combination passes the guard', () => {
    for (const cp of [null, 101n])
      for (const a of [false, true])
        for (const b of [false, true])
          for (const c of [false, true]) {
            const { instructions } = buildClockOutInstructions({ owner, plan: { checkpointRoundId: cp, claimOre: a, claimSol: b, closeAutomation: c }, inSignature: IN_SIG });
            expect(() => assertClockOutInvariants(instructions, { owner, inSignature: IN_SIG })).not.toThrow();
          }
  });
});

describe('assertClockOutInvariants refuses anything that is not exactly this wallet\'s clock-out', () => {
  const built = () => buildClockOutInstructions({ owner, plan: { checkpointRoundId: 101n, claimOre: true, claimSol: true, closeAutomation: true }, inSignature: IN_SIG }).instructions;
  const guard = (ixs: TransactionInstruction[]) => assertClockOutInvariants(ixs, { owner, inSignature: IN_SIG });
  const memo = () => shiftMemo(owner, formatOutMemo({ inSigPrefix: IN_SIG.slice(0, 16) }));
  const clone = (ix: TransactionInstruction, mut: (d: Buffer) => void) => {
    const d = Buffer.from(ix.data);
    mut(d);
    return new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: d });
  };

  it('a SOL transfer or any other program', () => {
    expect(() => guard([SystemProgram.transfer({ fromPubkey: owner, toPubkey: crank, lamports: 1 }), memo()])).toThrowError(/forbidden program/);
  });
  it('a clock-IN (Automate with a real executor) smuggled into a clock-out', () => {
    const a = automate({ authority: owner, executor: crank, amount: 1n, deposit: 1n, fee: 1n, mask: 1n, reload: false });
    expect(() => guard([a, memo()])).toThrowError(/stop/);
  });
  it('ClaimORE with a partial bps, or paying someone else\'s token account', () => {
    const ix = claimOre(owner);
    expect(() => guard([clone(ix, (d) => d.writeBigUInt64LE(5_000n, 1)), memo()])).toThrowError(/everything/);
    const other = new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k, i) => (i === 4 ? { ...k, pubkey: Keypair.generate().publicKey } : k)) });
    expect(() => guard([other, memo()])).toThrowError(/own ORE account/);
  });
  it('a claim / checkpoint / stop that targets another wallet\'s accounts', () => {
    const o = Keypair.generate().publicKey;
    const swap = (ix: TransactionInstruction, i: number, pk = pdas.miner(o)) => new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k, j) => (j === i ? { ...k, pubkey: pk } : k)) });
    expect(() => guard([swap(claimSol(owner), 2), memo()])).toThrowError(/own miner/);
    expect(() => guard([swap(checkpoint({ signer: owner, authority: owner, roundId: 1n }), 4), memo()])).toThrowError(/own miner/);
    expect(() => guard([swap(stopAutomation(owner), 1, pdas.automation(o)), memo()])).toThrowError(/own automation/);
  });
  it('a stop that is not zeroed (could carry settings) or uses the permissionless executor', () => {
    expect(() => guard([clone(stopAutomation(owner), (d) => (d[9] = 1)), memo()])).toThrowError(/malformed stop/);
  });
  it('another user must not be asked to sign', () => {
    const ix = claimSol(owner);
    const extra = new TransactionInstruction({ programId: ix.programId, data: ix.data, keys: ix.keys.map((k, i) => (i === 1 ? { ...k, isSigner: true } : k)) });
    expect(() => guard([extra, memo()])).toThrowError(/only the wallet may sign/);
  });
  it('order, duplicates, missing memo, memo not last, wrong/foreign memo', () => {
    const [cp, co, cs, st, m] = built() as [TransactionInstruction, TransactionInstruction, TransactionInstruction, TransactionInstruction, TransactionInstruction];
    expect(() => guard([co, cp, m])).toThrowError(/order/);
    expect(() => guard([cp, cp, m])).toThrowError(/order|duplicate/);
    expect(() => guard([st, cs, m])).toThrowError(/order/);
    expect(() => guard([cp, co])).toThrowError();
    expect(() => guard([m, cp])).toThrowError(/last/);
    expect(() => guard([cp, shiftMemo(owner, formatOutMemo({ inSigPrefix: 'bbbbbbbbbbbbbbbb' }))])).toThrowError(/does not point at this shift/);
    expect(() => guard([cp, shiftMemo(owner, 'SHIFT1|IN|nope')])).toThrowError(/valid SHIFT OUT/);
    expect(() => guard([cp, shiftMemo(Keypair.generate().publicKey, formatOutMemo({ inSigPrefix: IN_SIG.slice(0, 16) }))])).toThrowError();
  });
  it('an unknown ORE instruction (e.g. Deploy) and empty/oversized lists', () => {
    const deployLike = new TransactionInstruction({ programId: ORE_PROGRAM_ID, keys: claimSol(owner).keys, data: Buffer.from([6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
    expect(() => guard([deployLike, memo()])).toThrowError(/forbidden ORE instruction/);
    expect(() => guard([])).toThrowError(InvariantViolation);
    expect(() => guard([...built(), memo()])).toThrowError();
  });
});
