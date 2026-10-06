import { describe, expect, it } from 'vitest';
import { CLOCK_OUT_NOTICE, describePayslip } from './payslipText';
import type { Payslip } from './shift';

const base: Payslip = {
  shiftId: 's',
  status: 'paid',
  role: 'balanced',
  localDate: '2026-10-06',
  inBlockTime: 0,
  outSignature: 'o',
  outBlockTime: 1,
  budgetLamports: 50_000_000n,
  perSquareLamports: 100_000n,
  squares: 10,
  feePerRoundLamports: 1_000n,
  plannedRounds: 46,
  roundsWorked: 46,
  solDeployed: 46_000_000n,
  executorFees: 46_000n,
  solWon: 31_000_000n,
  oreEarned: 1_200_000_000n,
  oreEarlier: 0n,
  returnedAtClose: 3_954_000n,
  setupCost: 0n,
  netSol: 31_000_000n - 46_000_000n - 46_000n,
  claimedElsewhere: false,
  unsettledRound: false,
  superseded: false,
  needsClockOut: false,
  balanceLeftLamports: null,
  estimatedSecondsLeft: null,
};

describe('describePayslip (F6: losses first, plain language; NFR-A5)', () => {
  it('paid: "You put in X. You got back Y SOL + Z ORE." — what went in comes first', () => {
    const t = describePayslip(base);
    expect(t.headline).toBe('You put in 0.0500 SOL. You got back 0.0350 SOL + 0.0120 ORE.');
    expect(t.headline.indexOf('put in')).toBeLessThan(t.headline.indexOf('got back'));
  });
  it('net result always carries a sign AND a label, never colour alone', () => {
    expect(describePayslip(base).net).toEqual({ label: 'Net loss', value: '−0.015046 SOL' });
    expect(describePayslip({ ...base, netSol: 2_000_000n }).net).toEqual({ label: 'Net gain', value: '+0.002 SOL' });
    expect(describePayslip({ ...base, netSol: 0n }).net).toEqual({ label: 'Break-even', value: '0.00 SOL' });
  });
  it('no ORE shown when none; "unavailable" (never a made-up number) when unknown', () => {
    expect(describePayslip({ ...base, oreEarned: 0n }).headline).toBe('You put in 0.0500 SOL. You got back 0.0350 SOL.');
    expect(describePayslip({ ...base, oreEarned: null }).headline).toContain('ORE amount unavailable');
  });
  it('active: reports progress, not a final result', () => {
    const t = describePayslip({ ...base, status: 'active', outSignature: null, solDeployed: 2_000_000n, solWon: 1_500_000n });
    expect(t.headline).toBe('You put in 0.0500 SOL. So far 0.0020 SOL has been played and ORE has returned 0.0015 SOL.');
  });
  it('AC-6.3: claimed-elsewhere note; E-7: earlier rewards labelled; setup cost explained; network fees disclaimer always', () => {
    const t = describePayslip({ ...base, claimedElsewhere: true, oreEarlier: 700_000_000n, setupCost: 4_480_400n });
    expect(t.notes).toContain('Some rewards were claimed outside SHIFT.');
    expect(t.notes.some((n) => n.includes('earlier rewards') && n.includes('0.0070 ORE'))).toBe(true);
    expect(t.notes.some((n) => n.includes('0.0044804 SOL') && n.includes('not refundable'))).toBe(true);
    expect(t.notes).toContain('Network fees are not included.');
  });
  it('AC-6.5: the 24 h notice appears exactly when a clock-out is needed', () => {
    expect(describePayslip({ ...base, status: 'complete', outSignature: null, needsClockOut: true }).notes).toContain(`${CLOCK_OUT_NOTICE}.`);
    expect(describePayslip(base).notes.join(' ')).not.toContain('24 h');
    expect(CLOCK_OUT_NOTICE).toBe("Clock out within 24 h to keep your final round's rewards");
  });
  it('unsettled latest round is explained', () => {
    expect(describePayslip({ ...base, unsettledRound: true }).notes.some((n) => n.includes('not been settled'))).toBe(true);
  });
});
