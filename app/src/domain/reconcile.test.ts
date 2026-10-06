import { Keypair } from '@solana/web3.js';
import type { ShiftInMemo, ShiftOutMemo } from '@shift/codec';
import { describe, expect, it } from 'vitest';
import { FUNDED_FOREIGN, REAL_MINER, crank, owner } from './chainFixtures.testkit';
import { reconcile, type ReconcileInput } from './reconcile';

// One reference shift: Balanced, 0.02 SOL, 10 squares x 43_378, fee 1000 -> spend 434_780 per round, 46 rounds, setup 4_480_400.
const PER_SQUARE = 43_378n;
const ROUND_DEPLOYED = PER_SQUARE * 10n; // 433_780 deployed per round
const SPEND = ROUND_DEPLOYED + 1_000n;
const BUDGET = 20_000_000n;
const SETUP = 4_480_400n;
const IN_SIG = 'inSig1111111111111111111111111111111111111111111111111111111111111111111111111';
const OUT_SIG = 'outSig222222222222222222222222222222222222222222222222222222222222222222222222';
const T0 = 1_790_000_000;

const inMemo = (over: Partial<ShiftInMemo> = {}): ShiftInMemo => ({
  v: 1,
  kind: 'IN',
  signature: IN_SIG,
  blockTime: T0,
  role: 'balanced',
  budget: BUDGET,
  perSquare: PER_SQUARE,
  squares: 10,
  feePerRound: 1_000n,
  setupLamports: SETUP,
  baseLifeSol: 1_000n,
  baseLifeDeployed: 5_000n,
  baseOre: 0n,
  localDate: '2026-10-06',
  tzOffsetMin: 60,
  ...over,
});
const outMemo = (over: Partial<ShiftOutMemo> = {}): ShiftOutMemo => ({ v: 1, kind: 'OUT', signature: OUT_SIG, blockTime: T0 + 4_000, inSigPrefix: IN_SIG.slice(0, 16), ...over });

const minerAfter = (rounds: number, over: Record<string, unknown> = {}) => ({
  ...REAL_MINER,
  authority: owner,
  lifetimeDeployed: 5_000n + BigInt(rounds) * ROUND_DEPLOYED,
  lifetimeRewardsSol: 1_000n + BigInt(rounds) * 400_000n,
  rewardsOre: 0n,
  refinedOre: 0n,
  roundId: 100n,
  checkpointId: 100n,
  ...over,
});
const ourAutomation = (balance: bigint) => ({ ...FUNDED_FOREIGN, authority: owner, executor: crank, balance });

function run(over: Partial<ReconcileInput> = {}) {
  return reconcile({
    snapshot: { automation: null, miner: null },
    memos: [],
    owner,
    crank,
    crankStatus: 'ok',
    oreReceivedByOutSignature: new Map(),
    ...over,
  });
}

describe('empty ledger', () => {
  it('no memos: nothing current, no history', () => {
    expect(run()).toEqual({ current: undefined, history: [], shiftDays: [], pendingClockInSignature: null });
  });
});

describe('Active (running SHIFT automation, rounds being played)', () => {
  const state = () => run({ memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET - 5n * SPEND), miner: minerAfter(5) } });
  it('F6 formulas: deltas of Miner lifetime counters against the IN-memo baseline', () => {
    const p = state().current!;
    expect(p.status).toBe('active');
    expect(p.solDeployed).toBe(5n * ROUND_DEPLOYED); // 2_168_900
    expect(p.roundsWorked).toBe(5);
    expect(p.executorFees).toBe(5_000n);
    expect(p.solWon).toBe(5n * 400_000n);
    expect(p.setupCost).toBe(SETUP);
    expect(p.netSol).toBe(2_000_000n - 2_168_900n - 5_000n - SETUP);
    expect(p.plannedRounds).toBe(46);
    expect(p.balanceLeftLamports).toBe(BUDGET - 5n * SPEND);
    expect(p.returnedAtClose).toBe(BUDGET - 2_168_900n - 5_000n);
  });
  it('AC-5.1 inputs: progress = rounds worked / planned, time left from remaining rounds', () => {
    const p = state().current!;
    expect(p.estimatedSecondsLeft).toBe((46 - 5) * 78);
    expect(p.needsClockOut).toBe(false);
  });
  it('rounds worked is floor(deployed / per-round-squares): a partial round is not counted', () => {
    const miner = minerAfter(0, { lifetimeDeployed: 5_000n + ROUND_DEPLOYED * 3n + 1n });
    expect(run({ memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner } }).current!.roundsWorked).toBe(3);
  });
  it('unsettled round flag: miner has a round not yet checkpointed (figures lag)', () => {
    const p = run({ memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(2, { roundId: 102n, checkpointId: 101n }) } }).current!;
    expect(p.unsettledRound).toBe(true);
    expect(state().current!.unsettledRound).toBe(false);
  });
  it('ORE while unpaid is pending (refined + unrefined) minus baseline, gross', () => {
    const p = run({ memos: [inMemo({ baseOre: 100n })], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(1, { rewardsOre: 900n, refinedOre: 300n }) } }).current!;
    expect(p.oreEarned).toBe(1_100n); // (900 + 300) - 100
    expect(p.oreEarlier).toBe(100n); // E-7: labelled "earlier rewards", not this shift's
  });
});

describe('Paused (crank unhealthy)', () => {
  it.each(['offline', 'stalled'] as const)('crank %s while the automation is funded -> paused, back to active when healthy', (crankStatus) => {
    const snap = { automation: ourAutomation(BUDGET - SPEND), miner: minerAfter(1) };
    expect(run({ memos: [inMemo()], snapshot: snap, crankStatus }).current!.status).toBe('paused');
    expect(run({ memos: [inMemo()], snapshot: snap, crankStatus: 'ok' }).current!.status).toBe('active');
  });
  it('unknown crank status never produces a false Paused', () => {
    expect(run({ memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(0) }, crankStatus: 'unknown' }).current!.status).toBe('active');
  });
});

describe('Complete (AC-5.3, E-17, AC-6.5)', () => {
  it('automation closed/absent and no OUT -> complete', () => {
    const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(46) } }).current!;
    expect(p.status).toBe('complete');
    expect(p.roundsWorked).toBe(46);
    expect(p.canClockOut).toBe(true);
    expect(p.balanceLeftLamports).toBeNull();
    expect(p.estimatedSecondsLeft).toBeNull();
  });

  describe('AC-6.5 (PRD v1.6): the 24 h notice only when rewards are actually at stake', () => {
    const deployedSome = (() => {
      const d = new Array<bigint>(25).fill(0n);
      d[0] = 43_378n;
      return d;
    })();
    const noDeploy = new Array<bigint>(25).fill(0n);

    it('unchecked final round in which the miner deployed -> notice', () => {
      const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(46, { roundId: 102n, checkpointId: 101n, deployed: deployedSome }) } }).current!;
      expect(p.status).toBe('complete');
      expect(p.unsettledRound).toBe(true);
      expect(p.rewardsAtStake).toBe(true);
      expect(p.needsClockOut).toBe(true);
    });
    it('THE S-3 TEST CASE: a 0-round shift (fresh miner, nothing ever deployed or unchecked) must NOT nag, but can still be closed out', () => {
      const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(0, { roundId: 0n, checkpointId: 0n, deployed: noDeploy }) } }).current!;
      expect(p.status).toBe('complete');
      expect(p.roundsWorked).toBe(0);
      expect(p.needsClockOut).toBe(false);
      expect(p.rewardsAtStake).toBe(false);
      expect(p.canClockOut).toBe(true); // closing it out just records PAID
    });
    it('unchecked round but the miner deployed nothing in it -> nothing to forfeit, no notice', () => {
      const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(0, { roundId: 102n, checkpointId: 101n, deployed: noDeploy }) } }).current!;
      expect(p.unsettledRound).toBe(true);
      expect(p.needsClockOut).toBe(false);
    });
    it('all rounds already checkpointed (even with 46 rounds played) -> no notice: waiting costs nothing', () => {
      const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(46, { deployed: deployedSome }) } }).current!;
      expect(p.unsettledRound).toBe(false);
      expect(p.needsClockOut).toBe(false);
    });
    it('never shown for an active shift, a paid shift, or no miner', () => {
      const at = { roundId: 102n, checkpointId: 101n, deployed: deployedSome };
      expect(run({ memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(1, at) } }).current!.needsClockOut).toBe(false);
      expect(run({ memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(1, at) } }).history[0]!.needsClockOut).toBe(false);
      expect(run({ memos: [inMemo()], snapshot: { automation: null, miner: null } }).current!.needsClockOut).toBe(false);
    });
  });

  describe('canClockOut: the latest unpaid shift can be closed out in any non-paying state', () => {
    it.each([
      ['active', { automation: ourAutomation(BUDGET), miner: minerAfter(1) }, true],
      ['complete', { automation: null, miner: minerAfter(0) }, true],
    ] as const)('%s -> %s', (_n, snapshot, expected) => {
      expect(run({ memos: [inMemo()], snapshot }).current!.canClockOut).toBe(expected);
    });
    it('not while paying, not once paid, not for superseded shifts', () => {
      expect(run({ memos: [inMemo()], local: { payingInSigPrefix: IN_SIG.slice(0, 16) }, snapshot: { automation: null, miner: minerAfter(0) } }).current!.canClockOut).toBe(false);
      expect(run({ memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(0) } }).history[0]!.canClockOut).toBe(false);
    });
  });
  it('E-17: leftover below one round is Complete even if the account lingers', () => {
    const p = run({ memos: [inMemo()], snapshot: { automation: ourAutomation(SPEND - 1n), miner: minerAfter(46) } }).current!;
    expect(p.status).toBe('complete');
  });
  it('exactly one round of balance is still Active (boundary)', () => {
    expect(run({ memos: [inMemo()], snapshot: { automation: ourAutomation(SPEND), miner: minerAfter(45) } }).current!.status).toBe('active');
  });
  it('an automation that is not SHIFT\'s (other executor) is not "our" shift: Complete', () => {
    const foreign = { ...FUNDED_FOREIGN, authority: owner };
    expect(run({ memos: [inMemo()], snapshot: { automation: foreign, miner: minerAfter(3) } }).current!.status).toBe('complete');
    const other = { ...ourAutomation(BUDGET), executor: Keypair.generate().publicKey };
    expect(run({ memos: [inMemo()], snapshot: { automation: other, miner: minerAfter(3) } }).current!.status).toBe('complete');
  });
  it('without a configured crank key nothing is recognised as running', () => {
    expect(run({ crank: undefined, memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(1) } }).current!.status).toBe('complete');
  });
  it('E-25: ended within the first round: 0 rounds, full refund, loss = setup cost only', () => {
    const p = run({ memos: [inMemo()], snapshot: { automation: null, miner: minerAfter(0) } }).current!;
    expect(p.roundsWorked).toBe(0);
    expect(p.solDeployed).toBe(0n);
    expect(p.returnedAtClose).toBe(BUDGET);
    expect(p.netSol).toBe(-SETUP);
  });
});

describe('Paying (clock-out sent, not yet confirmed)', () => {
  const hint = { payingInSigPrefix: IN_SIG.slice(0, 16) };
  it('active shift being ended early -> paying', () => {
    expect(run({ memos: [inMemo()], local: hint, snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(1) } }).current!.status).toBe('paying');
  });
  it('complete shift being clocked out -> paying; if the clock-out failed (hint cleared) it returns to complete', () => {
    const snap = { automation: null, miner: minerAfter(46) };
    expect(run({ memos: [inMemo()], local: hint, snapshot: snap }).current!.status).toBe('paying');
    expect(run({ memos: [inMemo()], snapshot: snap }).current!.status).toBe('complete');
  });
  it('a hint for some other shift is ignored', () => {
    expect(run({ memos: [inMemo()], local: { payingInSigPrefix: 'zzzzzzzzzzzzzzzz' }, snapshot: { automation: null, miner: minerAfter(46) } }).current!.status).toBe('complete');
  });
});

describe('Paid', () => {
  it('OUT memo -> paid; no current shift; ORE comes from the OUT transaction (net)', () => {
    const r = run({ memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(46) }, oreReceivedByOutSignature: new Map([[OUT_SIG, 123_456_789n]]) });
    expect(r.current).toBeUndefined();
    const p = r.history[0]!;
    expect(p.status).toBe('paid');
    expect(p.outSignature).toBe(OUT_SIG);
    expect(p.oreEarned).toBe(123_456_789n);
    expect(p.needsClockOut).toBe(false);
    expect(p.claimedElsewhere).toBe(false);
  });
  it('OUT transaction not parsed yet -> ORE unknown (null), never a made-up number', () => {
    expect(run({ memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(46) } }).history[0]!.oreEarned).toBeNull();
  });
  it('matches the OUT to its IN by the 16-char signature prefix', () => {
    expect(run({ memos: [inMemo(), outMemo({ inSigPrefix: 'someoneelsesprefx' })], snapshot: { automation: null, miner: minerAfter(46) } }).history[0]!.status).toBe('complete');
  });
  it('a later playing-outside-SHIFT cannot inflate a paid shift beyond its budget', () => {
    const p = run({ memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(5_000) } }).history[0]!;
    expect(p.solDeployed).toBe(BUDGET);
  });
});

describe('AC-6.3 / E-7 / E-8: rewards claimed outside SHIFT', () => {
  it('ORE counter below the baseline: flagged, and the figure is 0, never negative', () => {
    const p = run({ memos: [inMemo({ baseOre: 5_000n })], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(2, { rewardsOre: 100n, refinedOre: 0n }) } }).current!;
    expect(p.claimedElsewhere).toBe(true);
    expect(p.oreEarned).toBe(0n);
  });
  it('equal to the baseline is NOT a claim', () => {
    const p = run({ memos: [inMemo({ baseOre: 100n })], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(2, { rewardsOre: 100n }) } }).current!;
    expect(p.claimedElsewhere).toBe(false);
    expect(p.oreEarned).toBe(0n);
  });
  it('SOL counters are monotonic: a lower reading (e.g. reinstall race) clamps to 0, never negative winnings', () => {
    const p = run({ memos: [inMemo({ baseLifeSol: 9_999_999n })], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(1) } }).current!;
    expect(p.solWon).toBe(0n);
  });
});

describe('several shifts: history never double-counts', () => {
  const IN2 = 'inSig3333333333333333333333333333333333333333333333333333333333333333333333333';
  it('older shift ends at the NEXT clock-in baselines; latest uses the live Miner', () => {
    const first = inMemo({ baseLifeDeployed: 0n, baseLifeSol: 0n, baseOre: 0n });
    const second = inMemo({ signature: IN2, blockTime: T0 + 100_000, baseLifeDeployed: 10n * ROUND_DEPLOYED, baseLifeSol: 3_000_000n, baseOre: 777n, setupLamports: 0n });
    const miner = { ...minerAfter(0), lifetimeDeployed: 10n * ROUND_DEPLOYED + 2n * ROUND_DEPLOYED, lifetimeRewardsSol: 3_000_000n + 500_000n, rewardsOre: 900n, refinedOre: 0n };
    const r = run({ memos: [second, first], snapshot: { automation: ourAutomation(BUDGET), miner } }); // given out of order on purpose
    expect(r.history.map((h) => h.shiftId)).toEqual([IN2, IN_SIG]);
    const [latest, older] = r.history as [(typeof r.history)[0], (typeof r.history)[0]];
    expect(older.status).toBe('complete');
    expect(older.superseded).toBe(true);
    expect(older.needsClockOut).toBe(false); // only the LATEST can nag (AC-6.5)
    expect(older.canClockOut).toBe(false);
    expect(older.roundsWorked).toBe(10);
    expect(older.solWon).toBe(3_000_000n);
    expect(older.oreEarned).toBe(777n); // pending at the next clock-in minus its own baseline
    expect(latest.status).toBe('active');
    expect(latest.roundsWorked).toBe(2);
    expect(latest.solWon).toBe(500_000n);
    expect(latest.oreEarned).toBe(900n - 777n);
    expect(r.current!.shiftId).toBe(IN2);
  });
  it('a paid older shift stays paid next to a new active one', () => {
    const second = inMemo({ signature: IN2, blockTime: T0 + 100_000, baseLifeDeployed: 10n * ROUND_DEPLOYED });
    const r = run({ memos: [inMemo(), outMemo(), second], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(0, { lifetimeDeployed: 10n * ROUND_DEPLOYED }) } });
    expect(r.history.map((h) => h.status)).toEqual(['active', 'paid']);
    expect(r.current!.shiftId).toBe(IN2);
  });
  it('duplicate memo entries (same signature) are counted once', () => {
    expect(run({ memos: [inMemo(), inMemo()], snapshot: { automation: null, miner: minerAfter(1) } }).history).toHaveLength(1);
  });
});

describe('F9 inputs: shiftDays (FR-9.4 applied once, here)', () => {
  it('one entry per clock-in, oldest first, duplicates kept', () => {
    const a = inMemo({ localDate: '2026-09-21', tzOffsetMin: 0 });
    const b = inMemo({ signature: '9' + 'x'.repeat(86), blockTime: T0 + 3_600, localDate: '2026-09-21', tzOffsetMin: 0 });
    expect(run({ memos: [b, a], snapshot: { automation: null, miner: minerAfter(0) } }).shiftDays).toEqual(['2026-09-21', '2026-09-21']);
  });
  it('FR-9.4: an implausible memo date is replaced by the blockTime date, in the shiftDays AND on the payslip', () => {
    // T0 = 1_790_000_000 is 2026-09-21T13:33:20Z; the memo claims a date 2 weeks later
    const r = run({ memos: [inMemo({ localDate: '2026-10-05', tzOffsetMin: 0 })], snapshot: { automation: null, miner: minerAfter(0) } });
    expect(r.shiftDays).toEqual(['2026-09-21']);
    expect(r.history[0]!.localDate).toBe('2026-09-21');
  });
  it('a plausible memo date is kept as written (E-16: 23:59 local counts for that day)', () => {
    const r = run({ memos: [inMemo({ localDate: '2026-09-21', tzOffsetMin: 60 })], snapshot: { automation: null, miner: minerAfter(0) } });
    expect(r.shiftDays).toEqual(['2026-09-21']);
  });
});

describe('Pending (clock-in sent, IN memo not yet on chain)', () => {
  it('reports the pending signature until the IN memo appears', () => {
    expect(run({ local: { pendingClockInSignature: 'PEND' } }).pendingClockInSignature).toBe('PEND');
    expect(run({ local: { pendingClockInSignature: IN_SIG }, memos: [inMemo()], snapshot: { automation: ourAutomation(BUDGET), miner: minerAfter(0) } }).pendingClockInSignature).toBeNull();
  });
});

describe('AC-6.2: reinstall rebuilds the same result from chain alone', () => {
  it('same chain + same memos => identical output regardless of any cache (purity)', () => {
    const input = { memos: [inMemo(), outMemo()], snapshot: { automation: null, miner: minerAfter(46) }, oreReceivedByOutSignature: new Map([[OUT_SIG, 5n]]) };
    expect(run(input)).toEqual(run({ ...input, memos: [...input.memos].reverse() }));
  });
});
