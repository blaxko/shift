import { describe, expect, it } from 'vitest';
import { BUDGET_PRESETS_LAMPORTS, LENGTH_PRESETS_MINUTES, MAX_BUDGET_LAMPORTS } from '../config/planning';
import { ROLE_ORDER, ROLES } from '../config/roles';
import { formatSol } from './format';
import { planShift, type PlanResult, type ShiftPlan } from './planShift';

const NOW = 1_790_000_000;
const ok = (r: PlanResult): ShiftPlan => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.plan;
};
const plan = (role: 'safe' | 'balanced' | 'sniper', budget: bigint, minutes: number) => planShift({ role, budgetLamports: budget, lengthMinutes: minutes, nowUnix: NOW });

describe('planShift: every preset combination (AC-2.1, AC-2.4)', () => {
  for (const role of ROLE_ORDER)
    for (const budget of BUDGET_PRESETS_LAMPORTS)
      for (const minutes of LENGTH_PRESETS_MINUTES) {
        it(`${role} / ${formatSol(budget)} SOL / ${minutes} min`, () => {
          const p = ok(plan(role, budget, minutes));
          // AC-2.1: max-loss figure == budget to 4 dp; NFR-S3: deposit == displayed budget
          expect(formatSol(p.budgetLamports, 4)).toBe(formatSol(budget, 4));
          expect(p.budgetLamports).toBe(budget);
          // sound arithmetic
          expect(p.squares).toBe(ROLES[role].squares);
          expect(p.perSquareLamports * BigInt(p.squares) + p.feePerRoundLamports).toBe(p.spendPerRoundLamports);
          expect(p.spendPerRoundLamports * BigInt(p.plannedRounds)).toBeLessThanOrEqual(budget);
          expect(p.leftoverLamports).toBeLessThan(p.spendPerRoundLamports);
          expect(p.leftoverLamports).toBe(budget - p.spendPerRoundLamports * BigInt(p.plannedRounds));
          // rules
          expect(p.perSquareLamports).toBeGreaterThanOrEqual(1000n);
          expect(p.feePerRoundLamports * 100n).toBeLessThanOrEqual(p.spendPerRoundLamports * 5n);
          // none of the shipped presets needs shortening at fee 1000 (documented so a config change is noticed)
          expect(p.shortenedFrom).toBeUndefined();
          expect(p.estimatedEndUnix).toBe(NOW + p.plannedRounds * 78);
          expect(p.totalFeeLamports).toBe(BigInt(p.plannedRounds) * 1000n);
        });
      }
});

describe('planShift: hand-computed values (78 s rounds, 1000-lamport fee)', () => {
  it('balanced / 0.05 SOL / 1 h', () => {
    const p = ok(plan('balanced', 50_000_000n, 60));
    expect(p.requestedRounds).toBe(46); // floor(3600 / 78)
    expect(p.perSquareLamports).toBe(108_595n); // floor((floor(50e6/46)=1_086_956 - 1000) / 10)
    expect(p.spendPerRoundLamports).toBe(1_086_950n);
    expect(p.plannedRounds).toBe(46);
    expect(p.leftoverLamports).toBe(300n);
    expect(p.totalFeeLamports).toBe(46_000n);
    expect(p.feeShareOfBudgetBps).toBe(9); // 0.092 %
  });
  it('safe / 0.02 SOL / 8 h', () => {
    const p = ok(plan('safe', 20_000_000n, 480));
    expect(p.requestedRounds).toBe(369); // floor(28800 / 78)
    expect(p.perSquareLamports).toBe(2_660n);
    expect(p.spendPerRoundLamports).toBe(54_200n);
    expect(p.plannedRounds).toBe(369);
    expect(p.leftoverLamports).toBe(200n);
    expect(p.feeShareOfBudgetBps).toBe(184); // 369,000 / 20,000,000 = 1.845 %
  });
  it('sniper / 0.10 SOL / 4 h', () => {
    const p = ok(plan('sniper', 100_000_000n, 240));
    expect(p.requestedRounds).toBe(184);
    expect(p.perSquareLamports).toBe(180_826n); // floor((floor(100e6 / 184) = 543_478 - 1000) / 3) = floor(542_478 / 3)
  });
});

describe('MIN_PER_SQUARE boundary (AC-2.2)', () => {
  // safe = 20 squares: perSquare == 1000 needs perRound == 21_000 (spend 21_000, fee share 4.76 %)
  it('exactly at the minimum: not shortened', () => {
    const p = ok(plan('safe', 21_000n * 46n, 60));
    expect(p.perSquareLamports).toBe(1_000n);
    expect(p.shortenedFrom).toBeUndefined();
    expect(p.plannedRounds).toBe(46);
  });
  it('one lamport below: shortened to 45 rounds with reason min-per-square', () => {
    const p = ok(plan('safe', 21_000n * 46n - 1n, 60));
    expect(p.shortenedFrom).toEqual({ rounds: 46, reason: 'min-per-square' });
    expect(p.perSquareLamports).toBeGreaterThanOrEqual(1_000n);
    expect(p.plannedRounds).toBeLessThan(46);
  });
});

describe('fee <= 5 % of per-round spend (decision OQ-5)', () => {
  // balanced = 10 squares: fee is exactly 5 % when spend == 20_000 (perSquare 1_900)
  it('exactly 5 %: allowed (inclusive)', () => {
    const p = ok(plan('balanced', 20_000n * 46n, 60));
    expect(p.spendPerRoundLamports).toBe(20_000n);
    expect(p.shortenedFrom).toBeUndefined();
  });
  it('just over 5 %: rounds reduced, reason fee-share', () => {
    const p = ok(plan('balanced', 20_000n * 46n - 1n, 60));
    expect(p.shortenedFrom).toEqual({ rounds: 46, reason: 'fee-share' });
    expect(p.feePerRoundLamports * 100n).toBeLessThanOrEqual(p.spendPerRoundLamports * 5n);
  });
  it('both rules failing: reason "both"', () => {
    const p = ok(plan('balanced', 100_000n, 60));
    expect(p.shortenedFrom?.reason).toBe('both');
  });
  it('cannot meet the rules even with one round: rejected', () => {
    expect(plan('balanced', 19_999n, 60)).toEqual({ ok: false, reason: 'too-small' });
    expect(plan('balanced', 20_000n, 60).ok).toBe(true); // a single round of exactly 20_000
  });
});

describe('NFR-S3 and input validation', () => {
  it('budget cap 0.5 SOL is accepted, one lamport more is rejected', () => {
    expect(plan('safe', MAX_BUDGET_LAMPORTS, 480).ok).toBe(true);
    expect(plan('safe', MAX_BUDGET_LAMPORTS + 1n, 480)).toEqual({ ok: false, reason: 'budget-over-cap' });
  });
  it('rejects non-positive budgets and bad lengths', () => {
    expect(plan('safe', 0n, 60)).toEqual({ ok: false, reason: 'budget-not-positive' });
    expect(plan('safe', -5n, 60)).toEqual({ ok: false, reason: 'budget-not-positive' });
    expect(plan('safe', 20_000_000n, 0)).toEqual({ ok: false, reason: 'bad-length' });
    expect(plan('safe', 20_000_000n, Number.NaN)).toEqual({ ok: false, reason: 'bad-length' });
  });
  it('a very short length still plans at least one round', () => {
    expect(ok(plan('safe', 20_000_000n, 1)).plannedRounds).toBeGreaterThanOrEqual(1);
  });
});

describe('property sweep: invariants hold for every successful plan', () => {
  it('~2000 budget/role/length combinations', () => {
    let okCount = 0;
    for (const role of ROLE_ORDER)
      for (const minutes of [1, 30, 60, 240, 480, 600])
        for (let b = 15_000n; b <= MAX_BUDGET_LAMPORTS; b = b * 13n / 10n + 1n) {
          const r = plan(role, b, minutes);
          if (!r.ok) continue;
          okCount++;
          const p = r.plan;
          expect(p.budgetLamports).toBe(b);
          expect(p.perSquareLamports).toBeGreaterThanOrEqual(1_000n);
          expect(p.feePerRoundLamports * 100n).toBeLessThanOrEqual(p.spendPerRoundLamports * 5n);
          expect(p.spendPerRoundLamports * BigInt(p.plannedRounds)).toBeLessThanOrEqual(b);
          expect(p.plannedRounds).toBeGreaterThanOrEqual(1);
        }
    expect(okCount).toBeGreaterThan(50);
  });
});
