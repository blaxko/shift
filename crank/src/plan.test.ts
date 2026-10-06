import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { U64_MAX, planRound, popcount, roundCost, windowOpen } from './plan';
import { automation, board, executor, miner } from './crank.testkit';

const plan = (autos: ReturnType<typeof automation>[], miners: Map<string, ReturnType<typeof miner> | null>, b = board()) =>
  planRound({ board: b, automations: autos, miners, executor });
const minersFor = (autos: ReturnType<typeof automation>[], over = {}) => new Map(autos.map((a) => [a.authority.toBase58(), miner(a.authority, over)]));

describe('windowOpen (deploy.rs:33, 47-50)', () => {
  const b = board({ startSlot: 1_000n, endSlot: 1_240n });
  it('open inside [start, end - margin)', () => {
    expect(windowOpen(b, 1_000n, 8n)).toBe(true);
    expect(windowOpen(b, 1_231n, 8n)).toBe(true);
  });
  it('closed before start, and from end - margin on', () => {
    expect(windowOpen(b, 999n, 8n)).toBe(false);
    expect(windowOpen(b, 1_232n, 8n)).toBe(false);
    expect(windowOpen(b, 1_240n, 0n)).toBe(false);
    expect(windowOpen(b, 1_239n, 0n)).toBe(true);
  });
  it('end_slot == u64::MAX means WAITING for the first deploy: open (the first Deploy starts the round)', () => {
    expect(windowOpen(board({ startSlot: 1_000n, endSlot: U64_MAX }), 1_050n, 8n)).toBe(true);
    expect(windowOpen(board({ startSlot: 1_000n, endSlot: U64_MAX }), 999n, 8n)).toBe(false);
  });
});

describe('round cost and balance boundary (AC-4.2)', () => {
  it('popcount and cost = amount × squares + fee', () => {
    expect(popcount(0b1011n)).toBe(3);
    expect(popcount((1n << 25n) - 1n)).toBe(25);
    expect(roundCost(automation({ amount: 1_000n, mask: 0b11111n, fee: 1_000n }))).toBe(6_000n);
  });
  it('exactly one round of balance is eligible; one lamport less is skipped without error', () => {
    const ok = automation({ balance: 6_000n });
    const low = automation({ balance: 5_999n });
    const p = plan([ok, low], minersFor([ok, low]));
    expect(p.items.map((i) => i.authority.toBase58())).toEqual([ok.authority.toBase58()]);
    expect(p.skipped).toEqual([{ authority: low.authority.toBase58(), reason: 'insufficient-balance' }]);
    expect(p.activeCount).toBe(1);
  });
  it('a depleted automation (ORE closes it; may linger one tick) never produces work or errors', () => {
    const a = automation({ balance: 0n });
    expect(() => plan([a], minersFor([a]))).not.toThrow();
    expect(plan([a], minersFor([a])).items).toEqual([]);
  });
});

describe('what the crank is willing to run (trust model)', () => {
  it('only Preferred automations (never Random/Discretionary)', () => {
    for (const strategy of [0n, 2n, 3n]) {
      const a = automation({ strategy });
      expect(plan([a], minersFor([a])).skipped[0]?.reason).toBe('not-preferred');
    }
  });
  it('skips malformed parameters', () => {
    const a = automation({ amount: 0n });
    const b = automation({ mask: 0n });
    const p = plan([a, b], minersFor([a, b]));
    expect(p.skipped.map((s) => s.reason)).toEqual(['bad-params', 'bad-params']);
  });
  it('ignores automations of other executors even if handed to it', () => {
    const a = automation({ executor: Keypair.generate().publicKey });
    expect(plan([a], minersFor([a])).items).toEqual([]);
  });
  it('NEVER pays to create a missing Miner (deploy.rs:218-226 would charge the executor)', () => {
    const a = automation();
    const p = plan([a], new Map([[a.authority.toBase58(), null]]));
    expect(p.items).toEqual([]);
    expect(p.skipped[0]?.reason).toBe('no-miner');
  });
});

describe('checkpoint-before-deploy (deploy.rs:251-256)', () => {
  it('previous round already checkpointed: deploy only', () => {
    const a = automation();
    const p = plan([a], minersFor([a], { roundId: 99n, checkpointId: 99n }));
    expect(p.items[0]!.checkpointRoundId).toBeNull();
  });
  it('previous round NOT checkpointed: Checkpoint(miner.roundId) first', () => {
    const a = automation();
    const p = plan([a], minersFor([a], { roundId: 98n, checkpointId: 97n }));
    expect(p.items[0]!.checkpointRoundId).toBe(98n);
  });
  it('already rolled into this round and deployed: skip (nothing to do)', () => {
    const a = automation();
    const deployed = new Array<bigint>(25).fill(0n);
    deployed[0] = 1_000n;
    const p = plan([a], minersFor([a], { roundId: 100n, deployed }));
    expect(p.items).toEqual([]);
    expect(p.skipped[0]?.reason).toBe('already-deployed');
    expect(p.activeCount).toBe(1); // still an active automation, just done for this round
  });
  it('rolled into this round but deployed nothing: still deploy, no checkpoint', () => {
    const a = automation();
    const p = plan([a], minersFor([a], { roundId: 100n, checkpointId: 99n }));
    expect(p.items[0]!.checkpointRoundId).toBeNull();
  });
  it('brand-new miner (roundId 0, checkpointId 0): deploy only', () => {
    const a = automation();
    expect(plan([a], minersFor([a], { roundId: 0n, checkpointId: 0n })).items[0]!.checkpointRoundId).toBeNull();
  });
});

describe('statelessness (AC-4.3): the plan is a pure function of chain data', () => {
  it('same inputs, same plan, regardless of history', () => {
    const autos = [automation(), automation(), automation({ balance: 1n })];
    const m = minersFor(autos);
    expect(plan(autos, m)).toEqual(plan(autos, m));
  });
});
