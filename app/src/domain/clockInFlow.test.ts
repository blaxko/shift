import { MEMO_PROGRAM_ID, ORE_PROGRAM_ID, formatInMemo } from '@shift/codec';
import { describe, expect, it } from 'vitest';
import type { ChainResult } from './chainState';
import { findOurShift, runClockIn, runEndShift, type FlowStatus, type RecentSig } from './clockInFlow';
import { appError } from './errors';
import { BLOCKHASH, FUNDED_FOREIGN, IDLE_SHELL, RENT_AUTOMATION, RENT_MINER, crank, input, makeDeps, owner, plan, state } from './chainFixtures.testkit';

const P = plan(20_000_000n);
const okState = (over = {}): ChainResult => ({ ok: true, state: state(over) });
const autoOurs = (balance = 19_000_000n) => ({ ...FUNDED_FOREIGN, authority: owner, executor: crank, balance });
const programs = (tx: import('@solana/web3.js').VersionedTransaction) =>
  tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58());

describe('happy path (AC-3.1, FR-3.3)', () => {
  it('submits exactly ONE transaction containing Automate + the IN memo, and reports success', async () => {
    const { deps, calls } = makeDeps();
    const seen: FlowStatus[] = [];
    const r = await runClockIn(input(P), deps, (s) => seen.push(s));
    expect(r).toEqual({ kind: 'success', signature: 'SIG_1', via: 'confirmed' });
    expect(calls.signAndSend).toBe(1);
    expect(calls.simulate).toBe(1);
    expect(programs(calls.txs[0]!)).toEqual([ORE_PROGRAM_ID.toBase58(), MEMO_PROGRAM_ID.toBase58()]);
    expect(calls.txs[0]!.message.recentBlockhash).toBe(BLOCKHASH);
    expect(seen).toEqual(['checking', 'simulating', 'awaiting-wallet', 'confirming']);
  });
  it('the signed transaction deposits exactly the displayed budget (NFR-S3) with reload 0 (NFR-S4)', async () => {
    const { deps, calls } = makeDeps();
    await runClockIn(input(P), deps);
    const ix = calls.txs[0]!.message.compiledInstructions[0]!;
    const d = Buffer.from(ix.data);
    expect(d.readBigUInt64LE(9)).toBe(P.budgetLamports);
    expect(d.subarray(34, 42).every((b) => b === 0)).toBe(true);
  });
  it('idle shell: ONE transaction with stop + Automate + memo (3 instructions)', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: { ...IDLE_SHELL, authority: owner, executor: owner }, miner: null })] });
    const r = await runClockIn(input(P), deps);
    expect(r.kind).toBe('success');
    expect(calls.signAndSend).toBe(1);
    expect(calls.txs[0]!.message.compiledInstructions).toHaveLength(3);
  });
  it('confirmation is polled until confirmed (processed -> confirmed)', async () => {
    const { deps, calls } = makeDeps({ status: (_s, n) => (n < 2 ? { confirmationStatus: 'processed', err: null } : { confirmationStatus: 'confirmed', err: null }) });
    expect((await runClockIn(input(P), deps)).kind).toBe('success');
    expect(calls.sleeps).toBeGreaterThanOrEqual(2);
  });
});

describe('AC-3.3: simulation failure never opens the wallet', () => {
  it('returns a readable error and signAndSend is never called', async () => {
    const { deps, calls } = makeDeps({ sim: { err: { InsufficientFundsForRent: { account_index: 1 } }, logs: ['x'] } });
    const r = await runClockIn(input(P), deps);
    expect(r.kind).toBe('simulation-failed');
    if (r.kind === 'simulation-failed') {
      expect(r.error.code).toBe('SIMULATION_FAILED');
      expect(r.error.userMessage).toMatch(/Nothing was sent/);
    }
    expect(calls.signAndSend).toBe(0);
  });
});

describe('FR-3.1 / AC-3.5: existing automations', () => {
  it('a funded foreign automation blocks: no simulate, no wallet, nothing built', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: { ...FUNDED_FOREIGN, authority: owner } })] });
    expect(await runClockIn(input(P), deps)).toEqual({ kind: 'blocked', reason: 'foreign-automation' });
    expect(calls.simulate + calls.signAndSend).toBe(0);
  });
  it('a running SHIFT automation blocks a second clock-in (never two shifts)', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: autoOurs() })] });
    expect(await runClockIn(input(P), deps)).toEqual({ kind: 'blocked', reason: 'shift-active' });
    expect(calls.signAndSend).toBe(0);
  });
  it('insufficient SOL blocks with the shortfall and never reaches the wallet (AC-2.3 at submit time)', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ balanceLamports: 1_000_000n })] });
    const r = await runClockIn(input(P), deps);
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') {
      expect(r.reason).toBe('insufficient-sol');
      expect(r.shortfallLamports).toBe(20_000_000n + RENT_AUTOMATION + RENT_MINER + 10_000n + 10_000n + 10_000_000n - 1_000_000n);
    }
    expect(calls.signAndSend).toBe(0);
  });
  it('chain unavailable / ORE layout changed (E-11) block before anything is built', async () => {
    let r = await runClockIn(input(P), makeDeps({ states: [{ ok: false, error: appError('RPC_UNAVAILABLE', 'x', 'y') }] }).deps);
    expect(r).toMatchObject({ kind: 'blocked', reason: 'chain-unavailable' });
    const { deps, calls } = makeDeps({ states: [{ ok: false, error: appError('LAYOUT_MISMATCH', 'x', 'y') }] });
    r = await runClockIn(input(P), deps);
    expect(r).toMatchObject({ kind: 'blocked', reason: 'maintenance' });
    expect(calls.simulate + calls.signAndSend).toBe(0);
  });
});

describe('E-2: user declines in the wallet', () => {
  it.each([[-1], [-3]])('protocol code %i -> cancelled, no polling, no state change', async (code) => {
    const { deps, calls } = makeDeps({ signAndSend: async () => { throw Object.assign(new Error('declined'), { code }); } });
    expect(await runClockIn(input(P), deps)).toEqual({ kind: 'cancelled' });
    expect(calls.signAndSend).toBe(1);
    expect(calls.loadState).toBe(1); // no reconcile needed: nothing could have been sent
  });
});

describe('AC-3.4 / E-3 / E-4: unknown send state -> reconcile before any retry', () => {
  const sessionDrop = async () => { throw new Error('MWA session closed'); };

  it('E-3: wallet drops after signing and the shift IS on chain -> success via reconcile, never a second submit', async () => {
    const { deps, calls } = makeDeps({ states: [okState(), okState({ automation: autoOurs() })], signAndSend: sessionDrop, lastValid: 1050, heightStep: 30 });
    const r = await runClockIn(input(P), deps);
    expect(r).toMatchObject({ kind: 'success', via: 'reconciled' });
    expect(calls.signAndSend).toBe(1); // exactly once: AC-3.4
  });
  it('waits for the blockhash to expire before concluding anything (the tx could still land)', async () => {
    let height = 0;
    const { deps, calls } = makeDeps({ states: [okState(), okState()], signAndSend: sessionDrop, lastValid: 1100, startHeight: 1000, heightStep: 10 });
    const orig = deps.blockHeight;
    deps.blockHeight = async () => (height = await orig());
    const r = await runClockIn(input(P), deps);
    expect(height).toBeGreaterThan(1100); // we kept polling until past lastValidBlockHeight
    expect(calls.sleeps).toBeGreaterThan(5);
    expect(r).toMatchObject({ kind: 'failed', retryable: true });
  });
  it('E-4: nothing landed after expiry -> retryable failure with a calm message', async () => {
    const { deps, calls } = makeDeps({ states: [okState(), okState()], status: () => null, lastValid: 1050, heightStep: 30 });
    const r = await runClockIn(input(P), deps);
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') {
      expect(r.retryable).toBe(true);
      expect(r.error.code).toBe('EXPIRED');
      expect(r.error.userMessage).toMatch(/Nothing was taken/);
    }
    expect(calls.signAndSend).toBe(1);
  });
  it('signature returned but never reported, shift finished already (automation closed): the IN memo proves it landed', async () => {
    const memo = formatInMemo({ role: 'balanced', budget: P.budgetLamports, perSquare: P.perSquareLamports, squares: 10, feePerRound: 1000n, setupLamports: 0n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-06', tzOffsetMin: 60 });
    const recent: RecentSig[] = [{ signature: 'SIG_FROM_CHAIN', blockTime: 1_790_000_005, memo: `[${memo.length}] ${memo}`, err: null }];
    const { deps } = makeDeps({ states: [okState(), okState()], status: () => null, recent, lastValid: 1050, heightStep: 30 });
    expect(await runClockIn(input(P), deps)).toEqual({ kind: 'success', signature: 'SIG_FROM_CHAIN', via: 'reconciled' });
  });
  it('a transaction that landed but failed on chain is a retryable TX_FAILED (nothing but the fee was spent)', async () => {
    const { deps } = makeDeps({ status: () => ({ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }) });
    const r = await runClockIn(input(P), deps);
    expect(r).toMatchObject({ kind: 'failed', retryable: true });
    if (r.kind === 'failed') expect(r.error.code).toBe('TX_FAILED');
  });
  it('RPC never shows block-height progress: gives up NON-retryable (tell the user to check Home)', async () => {
    const { deps, calls } = makeDeps({ states: [okState(), okState()], status: () => null, lastValid: 1_000_000, heightStep: 0, signAndSend: sessionDrop });
    const r = await runClockIn(input(P), deps);
    expect(r).toMatchObject({ kind: 'failed', retryable: false });
    expect(calls.signAndSend).toBe(1);
  });
  it('cannot reconcile (RPC down after expiry): non-retryable, never auto-retries', async () => {
    const { deps } = makeDeps({ states: [okState(), { ok: false, error: appError('RPC_UNAVAILABLE', 'x', 'down') }], status: () => null, lastValid: 1050, heightStep: 30 });
    const r = await runClockIn(input(P), deps);
    expect(r).toMatchObject({ kind: 'failed', retryable: false });
  });
});

describe('findOurShift (pure reconcile)', () => {
  const base = { crank, plan: P, startedAtUnix: 1_790_000_000, recent: [] as RecentSig[] };
  const memoFor = (budget = P.budgetLamports) => {
    const m = formatInMemo({ role: 'balanced', budget, perSquare: P.perSquareLamports, squares: 10, feePerRound: 1000n, setupLamports: 0n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-06', tzOffsetMin: 0 });
    return `[${m.length}] ${m}`;
  };
  it('funded automation run by the crank -> found', () => {
    expect(findOurShift({ ...base, state: state({ automation: autoOurs() }) }).found).toBe(true);
  });
  it('no automation, no memo -> not found', () => {
    expect(findOurShift({ ...base, state: state() })).toEqual({ found: false, signature: null });
  });
  it('automation with another executor or zero balance -> not ours', () => {
    expect(findOurShift({ ...base, state: state({ automation: { ...FUNDED_FOREIGN, authority: owner } }) }).found).toBe(false);
    expect(findOurShift({ ...base, state: state({ automation: autoOurs(0n) }) }).found).toBe(false);
  });
  it('memo must match budget/role, be recent, and be from a successful tx', () => {
    const r = (over: Partial<RecentSig>): RecentSig => ({ signature: 'S', blockTime: 1_790_000_010, memo: memoFor(), err: null, ...over });
    expect(findOurShift({ ...base, state: state(), recent: [r({})] }).found).toBe(true);
    expect(findOurShift({ ...base, state: state(), recent: [r({ memo: memoFor(50_000_000n) })] }).found).toBe(false);
    expect(findOurShift({ ...base, state: state(), recent: [r({ blockTime: 1_789_000_000 })] }).found).toBe(false);
    expect(findOurShift({ ...base, state: state(), recent: [r({ err: { InstructionError: [0, 'x'] } })] }).found).toBe(false);
    expect(findOurShift({ ...base, state: state(), recent: [r({ memo: '[5] hello' })] }).found).toBe(false);
  });
});

describe('runEndShift (early slice of F7): stop returns balance + rent', () => {
  it('stops a SHIFT automation with exactly one stop instruction', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: autoOurs() })] });
    const r = await runEndShift({ owner, crank }, deps);
    expect(r).toMatchObject({ kind: 'success', via: 'confirmed' });
    expect(calls.signAndSend).toBe(1);
    const tx = calls.txs[0]!;
    expect(tx.message.compiledInstructions).toHaveLength(1);
    const d = Buffer.from(tx.message.compiledInstructions[0]!.data);
    expect(d.length).toBe(66);
    expect(d.subarray(1, 33).every((b) => b === 0)).toBe(true); // all numeric fields zero: no funds can be added or moved elsewhere
  });
  it('no automation -> nothing to end, wallet never opened', async () => {
    const { deps, calls } = makeDeps({ states: [okState()] });
    expect(await runEndShift({ owner, crank }, deps)).toEqual({ kind: 'blocked', reason: 'no-shift' });
    expect(calls.signAndSend + calls.simulate).toBe(0);
  });
  it('a foreign automation is NEVER touched (not ours: executor != crank)', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: { ...FUNDED_FOREIGN, authority: owner } })] });
    expect(await runEndShift({ owner, crank }, deps)).toEqual({ kind: 'blocked', reason: 'foreign-automation' });
    expect(calls.signAndSend + calls.simulate).toBe(0);
  });
  it('simulation failure never opens the wallet', async () => {
    const { deps, calls } = makeDeps({ states: [okState({ automation: autoOurs() })], sim: { err: 'AccountNotFound', logs: null } });
    expect((await runEndShift({ owner, crank }, deps)).kind).toBe('simulation-failed');
    expect(calls.signAndSend).toBe(0);
  });
  it('declined in the wallet -> cancelled', async () => {
    const { deps } = makeDeps({ states: [okState({ automation: autoOurs() })], signAndSend: async () => { throw Object.assign(new Error('no'), { code: -3 }); } });
    expect(await runEndShift({ owner, crank }, deps)).toEqual({ kind: 'cancelled' });
  });
  it('unknown send state: success only if the automation is really gone; never a second submit', async () => {
    const drop = async () => { throw new Error('session closed'); };
    let { deps, calls } = makeDeps({ states: [okState({ automation: autoOurs() }), okState()], signAndSend: drop, lastValid: 1050, heightStep: 30 });
    expect(await runEndShift({ owner, crank }, deps)).toMatchObject({ kind: 'success', via: 'reconciled' });
    expect(calls.signAndSend).toBe(1);
    ({ deps, calls } = makeDeps({ states: [okState({ automation: autoOurs() }), okState({ automation: autoOurs() })], signAndSend: drop, lastValid: 1050, heightStep: 30 }));
    expect(await runEndShift({ owner, crank }, deps)).toMatchObject({ kind: 'failed', retryable: true });
    expect(calls.signAndSend).toBe(1);
  });
});
