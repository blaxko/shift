import { InvariantViolation, MEMO_PROGRAM_ID, ORE_PROGRAM_ID, parseMemo, pdas, shiftMemo, stopAutomation } from '@shift/codec';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { assertClockInInvariants, buildClockInInstructions, describeSimError } from './clockIn';
import { classifyExisting } from './conflict';
import { costBreakdown } from './costs';
import { IDLE_SHELL, FUNDED_FOREIGN, REAL_MINER, RENT_AUTOMATION, RENT_MINER, crank, owner, plan, state } from './chainFixtures.testkit';

const P = plan(20_000_000n);
const build = (over: Partial<Parameters<typeof buildClockInInstructions>[0]> = {}) =>
  buildClockInInstructions({ owner, crank, plan: P, chain: state(), existing: { kind: 'none' }, setupLamports: RENT_MINER + 10_000n, localDate: '2026-10-06', tzOffsetMin: 60, ...over });
const guard = (ixs: TransactionInstruction[], p = P) => assertClockInInvariants(ixs, { owner, crank, plan: p });
const clone = (ix: TransactionInstruction, mut: (d: Buffer) => void) => {
  const d = Buffer.from(ix.data);
  mut(d);
  return new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: d });
};

describe('buildClockInInstructions (AC-3.1)', () => {
  it('fresh wallet: exactly [Automate, IN memo] in one transaction', () => {
    const { instructions, memo } = build();
    expect(instructions).toHaveLength(2);
    expect(instructions[0]!.programId.equals(ORE_PROGRAM_ID)).toBe(true);
    expect(instructions[1]!.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(parseMemo(memo)?.kind).toBe('IN');
    guard(instructions);
  });
  it('NFR-S3: the deposit bytes equal the displayed budget exactly', () => {
    const d = build().instructions[0]!.data;
    expect(new DataView(d.buffer, d.byteOffset).getBigUint64(9, true)).toBe(P.budgetLamports);
  });
  it('NFR-S4: reload bytes are zero and strategy is Preferred', () => {
    const d = build().instructions[0]!.data;
    expect(d.subarray(34, 42).every((b) => b === 0)).toBe(true);
    expect(d[33]).toBe(1);
  });
  it('idle shell (FR-3.1 / OQ-4): [stop, Automate, memo] in ONE transaction', () => {
    const idle = classifyExisting(IDLE_SHELL, IDLE_SHELL.authority, crank);
    expect(idle.kind).toBe('idle-shell');
    const { instructions } = buildClockInInstructions({ owner: IDLE_SHELL.authority, crank, plan: P, chain: state({ automation: IDLE_SHELL }), existing: idle, setupLamports: 0n, localDate: '2026-10-06', tzOffsetMin: 0 });
    expect(instructions).toHaveLength(3);
    expect(instructions[0]!.keys[2]!.pubkey.equals(PublicKey.default)).toBe(true); // stop = executor default pubkey
    expect(instructions[0]!.data.equals(stopAutomation(IDLE_SHELL.authority).data)).toBe(true);
    assertClockInInvariants(instructions, { owner: IDLE_SHELL.authority, crank, plan: P });
  });
  it('AC-3.5: a funded / foreign / running automation is never touched: nothing is built', () => {
    for (const why of ['foreign', 'shift-active'] as const)
      expect(() => build({ existing: { kind: 'blocked', why } })).toThrowError(InvariantViolation);
    expect(classifyExisting(FUNDED_FOREIGN, FUNDED_FOREIGN.authority, crank).kind).toBe('blocked');
  });
  it('IN memo carries baselines from the Miner (ORE_NOTES 7.2/7.5), setup cost and date/tz', () => {
    const m = parseMemo(build({ chain: state({ miner: REAL_MINER }), setupLamports: 0n }).memo);
    expect(m).toMatchObject({
      kind: 'IN',
      role: 'balanced',
      budget: P.budgetLamports,
      perSquare: P.perSquareLamports,
      squares: 10,
      feePerRound: 1000n,
      setupLamports: 0n,
      baseLifeSol: REAL_MINER.lifetimeRewardsSol,
      baseLifeDeployed: REAL_MINER.lifetimeDeployed,
      baseOre: REAL_MINER.rewardsOre + REAL_MINER.refinedOre,
      localDate: '2026-10-06',
      tzOffsetMin: 60,
    });
  });
  it('no Miner yet: baselines are 0 and setup cost is recorded (payslip nets it later)', () => {
    const bd = costBreakdown(P, { hasMiner: false, minerReserveIsZero: false, reusesIdleShell: false, automationRentLamports: RENT_AUTOMATION, minerRentLamports: RENT_MINER });
    const m = parseMemo(build({ setupLamports: bd.setupLamports }).memo);
    expect(m).toMatchObject({ baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, setupLamports: RENT_MINER + 10_000n });
  });
});

describe('assertClockInInvariants refuses anything but the reviewed shape (NFR-S2/S3/S4)', () => {
  const ok = () => build().instructions;
  it('NFR-S3: deposit differing from the displayed budget (+1 lamport)', () => {
    const [a, m] = ok();
    expect(() => guard([clone(a!, (d) => d.writeBigUInt64LE(P.budgetLamports + 1n, 9)), m!])).toThrowError(/NFR-S3/);
  });
  it('NFR-S3: deposit over 0.5 SOL even if the plan were tampered to match', () => {
    const big = { ...P, budgetLamports: 500_000_001n };
    const [a, m] = ok();
    expect(() => guard([clone(a!, (d) => d.writeBigUInt64LE(500_000_001n, 9)), m!], big)).toThrowError(/NFR-S3/);
  });
  it('NFR-S4: any non-zero reload byte', () => {
    const [a, m] = ok();
    expect(() => guard([clone(a!, (d) => (d[34] = 1)), m!])).toThrowError(/NFR-S4/);
  });
  it('strategy other than Preferred (executor could pick squares)', () => {
    const [a, m] = ok();
    expect(() => guard([clone(a!, (d) => (d[33] = 2)), m!])).toThrowError(/Preferred/);
  });
  it('amount / fee / mask differing from the plan', () => {
    const [a, m] = ok();
    expect(() => guard([clone(a!, (d) => d.writeBigUInt64LE(P.perSquareLamports + 1n, 1)), m!])).toThrowError(/differ/);
    expect(() => guard([clone(a!, (d) => d.writeBigUInt64LE(P.feePerRoundLamports + 1n, 17)), m!])).toThrowError(/differ/);
    expect(() => guard([clone(a!, (d) => d.writeBigUInt64LE(P.mask + 1n, 25)), m!])).toThrowError(/differ/);
  });
  it('an unexpected extra instruction (e.g. a SOL transfer) is refused', () => {
    const [a, m] = ok();
    const steal = SystemProgram.transfer({ fromPubkey: owner, toPubkey: crank, lamports: 1 });
    expect(() => guard([a!, steal, m!])).toThrowError(/unexpected program/);
  });
  it('two Automate instructions / no memo / memo not last / two memos', () => {
    const [a, m] = ok();
    expect(() => guard([a!, a!, m!])).toThrowError();
    expect(() => guard([a!, a!])).toThrowError();
    expect(() => guard([m!, a!])).toThrowError(/last/);
    expect(() => guard([a!, m!, m!])).toThrowError();
    expect(() => guard([a!])).toThrowError();
  });
  it('wrong executor / foreign signer / another wallet\'s PDAs', () => {
    const [a, m] = ok();
    const other = Keypair.generate().publicKey;
    const keys = (i: number, pk: typeof other) => a!.keys.map((k, j) => (j === i ? { ...k, pubkey: pk } : k));
    expect(() => guard([new TransactionInstruction({ programId: a!.programId, keys: keys(2, other), data: a!.data }), m!])).toThrowError(/executor/);
    expect(() => guard([new TransactionInstruction({ programId: a!.programId, keys: keys(0, other), data: a!.data }), m!])).toThrowError();
    expect(() => guard([new TransactionInstruction({ programId: a!.programId, keys: keys(1, pdas.automation(other)), data: a!.data }), m!])).toThrowError(/own PDAs/);
  });
  it('memo that does not match the plan, or is not an IN memo, or is signed by someone else', () => {
    const [a] = ok();
    const otherPlan = plan(50_000_000n);
    expect(() => guard([a!, shiftMemo(owner, build().memo.replace('|20000000|', '|50000000|'))])).toThrowError(/memo does not match/);
    expect(() => guard([a!, shiftMemo(owner, 'hello')])).toThrowError(/valid SHIFT IN memo/);
    expect(() => guard([a!, shiftMemo(Keypair.generate().publicKey, build().memo)])).toThrowError(/memo may only be signed/);
    void otherPlan;
  });
  it('a stop that is not first, not zeroed, or targets someone else', () => {
    const [a, m] = ok();
    const stop = stopAutomation(owner);
    expect(() => guard([a!, stop, m!])).toThrowError();
    expect(() => guard([clone(stop, (d) => (d[1] = 1)), a!, m!])).toThrowError(/malformed stop/);
    expect(() => guard([stopAutomation(Keypair.generate().publicKey), a!, m!])).toThrowError(/someone else/);
    expect(() => guard([stop, a!, m!])).not.toThrow();
  });
});

describe('describeSimError (AC-3.3): readable, typed, raw text only in detail', () => {
  it('maps the common failures', () => {
    expect(describeSimError('AccountNotFound', null).userMessage).toMatch(/no SOL/);
    expect(describeSimError('InsufficientFundsForFee', null).userMessage).toMatch(/network fee/);
    expect(describeSimError({ InsufficientFundsForRent: { account_index: 3 } }, null).userMessage).toMatch(/rent/);
    expect(describeSimError({ InstructionError: [0, { Custom: 2 }] }, null).userMessage).toMatch(/executor/);
    expect(describeSimError({ InstructionError: [0, { Custom: 1 }] }, null).userMessage).toMatch(/not authorized/);
    expect(describeSimError({ InstructionError: [0, 'InvalidAccountData'] }, ['Program log: Account data is invalid']).userMessage).toMatch(/would fail/);
    expect(describeSimError({ InstructionError: [1, 'Custom'] }, ['Transfer: insufficient lamports 5, need 9']).userMessage).toMatch(/Not enough SOL/);
  });
  it('always says nothing was sent, is typed SIMULATION_FAILED, and keeps raw detail out of the message', () => {
    const e = describeSimError({ InstructionError: [0, { Custom: 7 }] }, ['Program log: secret-ish internals']);
    expect(e.code).toBe('SIMULATION_FAILED');
    expect(e.userMessage).toMatch(/Nothing was sent/);
    expect(e.userMessage).not.toMatch(/internals|Custom/);
    expect(e.detail).toContain('internals');
  });
});
