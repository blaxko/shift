import { describe, expect, it } from 'vitest';
import { livenessReport, type Snapshot } from './liveness';

// Reference shift: Balanced 0.02 SOL: 10 squares x 43_378 = 433_780 deployed per round, fee 1000 -> cost 434_780, 46 rounds.
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  at: 't',
  boardRound: '1000',
  lifetimeDeployed: '5000',
  automationBalance: '20000000',
  deployedPerRound: '433780',
  costPerRound: '434780',
  ...over,
});
const after = (rounds: number, deployedRounds: number, over: Partial<Snapshot> = {}) =>
  snap({ boardRound: String(1000 + rounds), lifetimeDeployed: String(5000n + BigInt(deployedRounds) * 433_780n), automationBalance: '0', ...over });

describe('livenessReport (AC-4.1: >= 98 % of rounds)', () => {
  it('every round deployed -> 100 %, PASS', () => {
    const r = livenessReport(snap(), after(23, 23));
    expect(r).toMatchObject({ roundsElapsed: 23, roundsExpected: 23, roundsDeployed: 23, missed: 0, rate: 1, pass: true });
  });
  it('a 30-minute window is ~23 rounds, so 98 % allows ZERO misses (the threshold is strict at this sample size)', () => {
    const miss1 = livenessReport(snap(), after(23, 22));
    expect(miss1.maxMissAllowed).toBe(0);
    expect(miss1.missed).toBe(1);
    expect(miss1.rate).toBeCloseTo(22 / 23);
    expect(miss1.pass).toBe(false);
  });
  it('a 60-round window allows one miss', () => {
    const s = snap({ automationBalance: '40000000' });
    expect(livenessReport(s, after(60, 59)).pass).toBe(true); // 98.3 %
    expect(livenessReport(s, after(60, 58)).pass).toBe(false); // 96.7 %
    expect(livenessReport(s, after(60, 59)).maxMissAllowed).toBe(1);
  });
  it('rounds after the budget ran out are NOT expected (the automation closed, not the crank failing)', () => {
    // 46 rounds affordable; 60 happened; all 46 deployed
    const r = livenessReport(snap(), after(60, 46));
    expect(r).toMatchObject({ roundsAffordable: 46, roundsExpected: 46, roundsDeployed: 46, missed: 0, pass: true });
  });
  it('affordable cap uses the START balance and the full round cost incl. fee', () => {
    expect(livenessReport(snap({ automationBalance: '434779' }), after(10, 0)).roundsAffordable).toBe(0);
    expect(livenessReport(snap({ automationBalance: '434780' }), after(10, 1)).roundsAffordable).toBe(1);
  });
  it('nothing deployed at all -> 0 %, FAIL', () => {
    const r = livenessReport(snap(), after(23, 0));
    expect(r).toMatchObject({ roundsDeployed: 0, missed: 23, rate: 0, pass: false });
  });
  it('no rounds elapsed / nothing expected is reported as unmeasurable, never a pass', () => {
    const r = livenessReport(snap(), after(0, 0));
    expect(r.pass).toBe(false);
    expect(r.notes.join(' ')).toMatch(/nothing to measure/);
  });
  it('lamports that are not a whole number of rounds are flagged (something else deployed)', () => {
    const r = livenessReport(snap(), snap({ boardRound: '1010', lifetimeDeployed: String(5000n + 433_780n * 5n + 7n), automationBalance: '0' }));
    expect(r.roundsDeployed).toBe(5);
    expect(r.notes.join(' ')).toMatch(/not a whole number/);
  });
  it('never reports more than 100 %', () => {
    expect(livenessReport(snap(), after(5, 9)).rate).toBe(1);
  });
});
