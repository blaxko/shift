import { describe, expect, it } from 'vitest';
import { checkBalance, costBreakdown, type ChainCostContext } from './costs';
import { planShift, type ShiftPlan } from './planShift';

const plan = (budget: bigint): ShiftPlan => {
  const r = planShift({ role: 'balanced', budgetLamports: budget, lengthMinutes: 60, nowUnix: 1_790_000_000 });
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};
// TEST DATA ONLY: rent as returned by mainnet on 2026-10-06 (5080 lamports/byte x (size + 128)). The app never hard-codes rent; it reads it live.
const RENT_AUTOMATION = (160n + 128n) * 5080n; // 1_463_040
const RENT_MINER = (752n + 128n) * 5080n; // 4_470_400
const fresh: ChainCostContext = { hasMiner: false, minerReserveIsZero: false, reusesIdleShell: false, automationRentLamports: RENT_AUTOMATION, minerRentLamports: RENT_MINER };
const kinds = (b: ReturnType<typeof costBreakdown>) => b.lines.map((l) => l.kind);

describe('costBreakdown (FR-2.1, AC-2.5)', () => {
  it('fresh wallet: all lines, correct refundable flags, setup = miner rent + 10_000 reserve', () => {
    const b = costBreakdown(plan(20_000_000n), fresh);
    expect(kinds(b)).toEqual(['budget', 'automation-rent', 'miner-rent', 'checkpoint-reserve', 'executor-fees', 'network-fee']);
    const refundable = Object.fromEntries(b.lines.map((l) => [l.kind, l.refundable]));
    expect(refundable).toEqual({ budget: true, 'automation-rent': true, 'miner-rent': false, 'checkpoint-reserve': false, 'executor-fees': false, 'network-fee': false });
    expect(b.setupLamports).toBe(RENT_MINER + 10_000n);
    // executor fees come out of the budget, so they are NOT added to what leaves the wallet
    expect(b.totalLeavingWalletNow).toBe(20_000_000n + RENT_AUTOMATION + RENT_MINER + 10_000n + 10_000n);
    expect(b.totalLeavingWalletNow).toBe(25_953_440n); // = 0.02595344 SOL, the figure seen on device in S-2
  });
  it('existing Miner with its reserve funded: no setup lines, setup 0 (AC-2.5: omitted when not charged)', () => {
    const b = costBreakdown(plan(20_000_000n), { ...fresh, hasMiner: true, minerReserveIsZero: false });
    expect(kinds(b)).toEqual(['budget', 'automation-rent', 'executor-fees', 'network-fee']);
    expect(b.setupLamports).toBe(0n);
  });
  it('existing Miner whose reserve was claimed (0): only the reserve line', () => {
    const b = costBreakdown(plan(20_000_000n), { ...fresh, hasMiner: true, minerReserveIsZero: true });
    expect(kinds(b)).toContain('checkpoint-reserve');
    expect(kinds(b)).not.toContain('miner-rent');
    expect(b.setupLamports).toBe(10_000n);
  });
  it('idle shell is swapped: automation rent adds 0 (closed + recreated in one tx, PRD v1.1 FR-3.1)', () => {
    const b = costBreakdown(plan(20_000_000n), { ...fresh, hasMiner: true, reusesIdleShell: true });
    expect(b.lines.find((l) => l.kind === 'automation-rent')?.lamports).toBe(0n);
  });
  it('the budget line is the max-loss figure and equals the plan budget exactly (NFR-S3)', () => {
    const p = plan(50_000_000n);
    expect(costBreakdown(p, fresh).lines[0]!.lamports).toBe(p.budgetLamports);
  });
  it('executor fee line equals the plan total', () => {
    const p = plan(50_000_000n);
    expect(costBreakdown(p, fresh).lines.find((l) => l.kind === 'executor-fees')?.lamports).toBe(p.totalFeeLamports);
  });
});

describe('rent comes from the chain context, never from constants', () => {
  it('changing the live rent changes the costs by exactly that amount', () => {
    const base = costBreakdown(plan(20_000_000n), fresh);
    const doubled = costBreakdown(plan(20_000_000n), { ...fresh, automationRentLamports: RENT_AUTOMATION * 2n, minerRentLamports: RENT_MINER * 2n });
    expect(doubled.totalLeavingWalletNow - base.totalLeavingWalletNow).toBe(RENT_AUTOMATION + RENT_MINER);
    expect(doubled.setupLamports - base.setupLamports).toBe(RENT_MINER);
  });
  it('the old (pre-2026-10-05) rent is not baked in anywhere: with zero rent only budget + reserve + network fee remain', () => {
    const b = costBreakdown(plan(20_000_000n), { ...fresh, automationRentLamports: 0n, minerRentLamports: 0n });
    expect(b.totalLeavingWalletNow).toBe(20_000_000n + 10_000n + 10_000n);
  });
});

describe('checkBalance (FR-2.2, AC-2.3)', () => {
  const b = costBreakdown(plan(20_000_000n), fresh);
  const needed = 20_000_000n + RENT_AUTOMATION + RENT_MINER + 10_000n + 10_000n + 10_000_000n; // + 0.01 SOL fee reserve
  it('exactly enough passes', () => {
    expect(checkBalance(needed, b)).toEqual({ ok: true, neededLamports: needed });
  });
  it('one lamport short fails and reports the shortfall', () => {
    expect(checkBalance(needed - 1n, b)).toEqual({ ok: false, neededLamports: needed, shortfallLamports: 1n });
  });
  it('a 0.05 SOL test wallet: first shift fits at 0.02 SOL budget but not at 0.05', () => {
    expect(checkBalance(50_000_000n, b).ok).toBe(true);
    const big = costBreakdown(plan(50_000_000n), fresh);
    const r = checkBalance(50_000_000n, big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.shortfallLamports).toBe(big.totalLeavingWalletNow + 10_000_000n - 50_000_000n);
  });
});
