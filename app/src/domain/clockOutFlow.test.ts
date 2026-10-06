import { MEMO_PROGRAM_ID, ORE_PROGRAM_ID, formatOutMemo, pdas } from '@shift/codec';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import type { ChainResult } from './chainState';
import type { RecentSig } from './clockInFlow';
import { findOutMemo, runClockOut } from './clockOutFlow';
import { appError } from './errors';
import { FUNDED_FOREIGN, REAL_MINER, crank, makeDeps, owner, state } from './chainFixtures.testkit';

const IN_SIG = '3Y' + 'a'.repeat(86);
const input = { owner, crank, inSignature: IN_SIG };
const OUT_TEXT = formatOutMemo({ inSigPrefix: IN_SIG.slice(0, 16) });
const outRecent = (over: Partial<RecentSig> = {}): RecentSig => ({ signature: 'OUT_ON_CHAIN', blockTime: 1_790_000_100, memo: `[${OUT_TEXT.length}] ${OUT_TEXT}`, err: null, ...over });

const miner = (over: Record<string, unknown> = {}) => ({ ...REAL_MINER, authority: owner, roundId: 100n, checkpointId: 100n, rewardsOre: 0n, refinedOre: 0n, rewardsSol: 0n, ...over });
const ours = { ...FUNDED_FOREIGN, authority: owner, executor: crank, balance: 15_000_000n };
const st = (over = {}): ChainResult => ({ ok: true, state: state({ miner: miner() as never, ...over }) });
const programs = (tx: import('@solana/web3.js').VersionedTransaction) => tx.message.compiledInstructions.map((ix) => ({ p: tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58(), d: Buffer.from(ix.data)[0]! }));
const minerAcct = (m: ReturnType<typeof miner>) => {
  // Re-encode the fixture-shaped miner bytes with chosen fields: reuse the real fixture buffer and patch the counters we care about.
  return { owner: ORE_PROGRAM_ID, data: patchedMinerBytes(m) };
};
const rawMiner = Buffer.from(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'codec', 'test', 'fixtures', 'miner-9MbHiQxn.json'), 'utf8')).dataBase64, 'base64');
function patchedMinerBytes(m: ReturnType<typeof miner>): Uint8Array {
  const b = Buffer.from(rawMiner);
  const base = 8 + 32 + 24 + 600 + 8 + 16; // rewards_sol offset (miner.rs field order)
  b.writeBigUInt64LE(m.rewardsSol, base);
  b.writeBigUInt64LE(m.refinedOre, base + 8);
  b.writeBigUInt64LE(m.rewardsOre, base + 16);
  b.writeBigUInt64LE(m.roundId, 8 + 32 + 24 + 600);
  b.writeBigUInt64LE(m.checkpointId, 8 + 32 + 8);
  return b;
}

describe('findOutMemo (pure)', () => {
  it('matches the OUT memo for this shift only, from a successful tx', () => {
    expect(findOutMemo([outRecent()], IN_SIG)?.signature).toBe('OUT_ON_CHAIN');
    expect(findOutMemo([outRecent({ err: { x: 1 } })], IN_SIG)).toBeNull();
    const other = formatOutMemo({ inSigPrefix: 'cccccccccccccccc' });
    expect(findOutMemo([outRecent({ memo: `[${other.length}] ${other}` })], IN_SIG)).toBeNull();
    expect(findOutMemo([], IN_SIG)).toBeNull();
  });
});

describe('THE S-3 CASE: clock out of a 0-round Complete shift', () => {
  it('sends ONE transaction containing only the OUT memo (nothing to checkpoint, claim or close)', async () => {
    const { deps, calls } = makeDeps({ states: [st({ miner: miner({ roundId: 0n, checkpointId: 0n }) as never })] });
    const r = await runClockOut(input, deps);
    expect(r).toMatchObject({ kind: 'success', via: 'confirmed' });
    expect(calls.signAndSend).toBe(1);
    expect(calls.simulateAccounts).toBe(0); // no checkpoint probe needed
    expect(programs(calls.txs[0]!)).toEqual([{ p: MEMO_PROGRAM_ID.toBase58(), d: OUT_TEXT.charCodeAt(0) }]);
  });
});

describe('AC-7.1 / AC-7.3 / AC-7.4: one transaction, parts omitted when empty', () => {
  it('active shift ended early: close + OUT memo in ONE tx (same flow as clock-out)', async () => {
    const { deps, calls } = makeDeps({ states: [st({ automation: ours })] });
    const r = await runClockOut(input, deps);
    expect(r.kind).toBe('success');
    expect(calls.signAndSend).toBe(1);
    expect(programs(calls.txs[0]!).map((x) => x.d)).toEqual([0, OUT_TEXT.charCodeAt(0)]); // stop (Automate disc 0) then memo
    if (r.kind === 'success') expect(r.plan).toMatchObject({ closeAutomation: true, claimOre: false, claimSol: false, checkpointRoundId: null });
  });
  it('claimable ORE: ClaimORE is included (no checkpoint)', async () => {
    const { deps, calls } = makeDeps({ states: [st({ miner: miner({ rewardsOre: 1_000n, refinedOre: 500n }) as never })] });
    await runClockOut(input, deps);
    expect(programs(calls.txs[0]!).map((x) => x.d)).toEqual([4, OUT_TEXT.charCodeAt(0)]);
  });
  it('rewards only appear AFTER the checkpoint: it is probed alone, then ClaimORE is added on the settled numbers', async () => {
    const before = miner({ roundId: 102n, checkpointId: 101n });
    const after = miner({ roundId: 102n, checkpointId: 102n, rewardsOre: 7_000n });
    const { deps, calls } = makeDeps({ states: [st({ miner: before as never })], simAccounts: [minerAcct(after)] });
    const r = await runClockOut(input, deps);
    expect(r.kind).toBe('success');
    expect(calls.simulateAccounts).toBe(1);
    expect(programs(calls.txs[0]!).map((x) => x.d)).toEqual([2, 4, OUT_TEXT.charCodeAt(0)]); // Checkpoint, ClaimORE, memo
  });
  it('checkpoint settles nothing claimable: Checkpoint + memo only (no useless ClaimORE / token-account creation)', async () => {
    const before = miner({ roundId: 102n, checkpointId: 101n });
    const { deps, calls } = makeDeps({ states: [st({ miner: before as never })], simAccounts: [minerAcct(miner({ roundId: 102n, checkpointId: 102n }))] });
    await runClockOut(input, deps);
    expect(programs(calls.txs[0]!).map((x) => x.d)).toEqual([2, OUT_TEXT.charCodeAt(0)]);
  });
  it('a foreign automation is never closed, but claims still work', async () => {
    const { deps, calls } = makeDeps({ states: [st({ automation: { ...FUNDED_FOREIGN, authority: owner } as never, miner: miner({ rewardsOre: 1n }) as never })] });
    await runClockOut(input, deps);
    expect(programs(calls.txs[0]!).map((x) => x.d)).toEqual([4, OUT_TEXT.charCodeAt(0)]);
  });
  it('every transaction is signed by the wallet only and targets its own PDAs', async () => {
    const { deps, calls } = makeDeps({ states: [st({ automation: ours, miner: miner({ rewardsOre: 1n, rewardsSol: 1n }) as never })] });
    await runClockOut(input, deps);
    const tx = calls.txs[0]!;
    expect(tx.message.staticAccountKeys[0]!.equals(owner)).toBe(true);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(pdas.miner(owner).toBase58());
    expect(keys).toContain(pdas.automation(owner).toBase58());
  });
});

describe('safety and failure paths', () => {
  it('never pays twice: an OUT memo already on chain blocks, no simulate, no wallet', async () => {
    const { deps, calls } = makeDeps({ states: [st()], recent: [outRecent()] });
    expect(await runClockOut(input, deps)).toEqual({ kind: 'blocked', reason: 'already-paid' });
    expect(calls.simulate + calls.signAndSend + calls.simulateAccounts).toBe(0);
  });
  it('chain unavailable / ORE layout changed block before anything is built', async () => {
    expect(await runClockOut(input, makeDeps({ states: [{ ok: false, error: appError('RPC_UNAVAILABLE', 'x', 'y') }] }).deps)).toMatchObject({ kind: 'blocked', reason: 'chain-unavailable' });
    expect(await runClockOut(input, makeDeps({ states: [{ ok: false, error: appError('LAYOUT_MISMATCH', 'x', 'y') }] }).deps)).toMatchObject({ kind: 'blocked', reason: 'maintenance' });
  });
  it('a failing checkpoint probe is a readable simulation failure and the wallet never opens', async () => {
    const { deps, calls } = makeDeps({ states: [st({ miner: miner({ roundId: 102n, checkpointId: 101n }) as never })], simAccountsErr: 'AccountNotFound' });
    const r = await runClockOut(input, deps);
    expect(r.kind).toBe('simulation-failed');
    expect(calls.signAndSend).toBe(0);
  });
  it('a failing final simulation never opens the wallet (AC-3.3 spirit)', async () => {
    const { deps, calls } = makeDeps({ states: [st({ automation: ours })], sim: { err: { InstructionError: [0, 'Custom'] }, logs: null } });
    expect((await runClockOut(input, deps)).kind).toBe('simulation-failed');
    expect(calls.signAndSend).toBe(0);
  });
  it('declined in the wallet -> cancelled, no state change', async () => {
    const { deps } = makeDeps({ states: [st({ automation: ours })], signAndSend: async () => { throw Object.assign(new Error('no'), { code: -3 }); } });
    expect(await runClockOut(input, deps)).toMatchObject({ kind: 'cancelled' });
  });
  it('unknown send state: success ONLY if the OUT memo is on chain after blockhash expiry; never a second submit', async () => {
    const drop = async () => { throw new Error('session closed'); };
    let { deps, calls } = makeDeps({ states: [st({ automation: ours })], signAndSend: drop, lastValid: 1050, heightStep: 30 });
    // first recentSignatures() call (pre-check) must be empty, later ones contain the OUT: script it
    let n = 0;
    deps.recentSignatures = async () => (n++ === 0 ? [] : [outRecent()]);
    expect(await runClockOut(input, deps)).toMatchObject({ kind: 'success', via: 'reconciled' });
    expect(calls.signAndSend).toBe(1);
    ({ deps, calls } = makeDeps({ states: [st({ automation: ours })], signAndSend: drop, lastValid: 1050, heightStep: 30 }));
    expect(await runClockOut(input, deps)).toMatchObject({ kind: 'failed', retryable: true });
    expect(calls.signAndSend).toBe(1);
  });
});
