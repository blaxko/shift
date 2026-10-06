import { describe, expect, it } from 'vitest';
import { createCrank, type LoopDeps } from './loop';
import { U64_MAX } from './plan';
import { automation, board, config, executor, fakeChain, fakeSubmitter, miner, newHealth, silentLog, type FakeChainState } from './crank.testkit';

const NOW = 1_790_000_000;

function setup(over: Partial<FakeChainState> = {}, submitter = fakeSubmitter(), cfg = config(), now = { t: NOW }) {
  const autos = over.automations ?? [automation(), automation()];
  const state: FakeChainState = {
    slot: 1_050n,
    board: board(),
    automations: autos,
    miners: new Map(autos.map((a) => [a.authority.toBase58(), miner(a.authority)])),
    balance: 200_000_000n,
    ...over,
  };
  const chain = fakeChain(state);
  const log = silentLog();
  const health = newHealth(cfg);
  const deps: LoopDeps = { chain, submitter, health, log, nowUnix: () => now.t, sleep: async () => undefined };
  return { crank: createCrank(cfg, deps), chain, submitter, health, log, state, now };
}

describe('a tick with work (F4)', () => {
  it('deploys every eligible automation, batched, for the CURRENT round', async () => {
    const { crank, submitter, health } = setup();
    const r = await crank.tick();
    expect(r).toMatchObject({ status: 'worked', roundId: 100n, planned: 2, ok: 2, failed: 0 });
    expect(submitter.batches).toHaveLength(1); // two deploys share one transaction
    expect(submitter.contexts[0]!.roundId).toBe(100n);
    expect(health.snapshot(NOW).lastRoundDeployedAt).toBe(NOW);
    expect(health.snapshot(NOW).activeAutomations).toBe(2);
  });
  it('adds the Checkpoint for a miner that has not settled its previous round', async () => {
    const a = automation();
    const { crank, submitter } = setup({ automations: [a], miners: new Map([[a.authority.toBase58(), miner(a.authority, { roundId: 98n, checkpointId: 97n })]]) });
    await crank.tick();
    expect(submitter.batches[0]!.items[0]!.checkpointRoundId).toBe(98n);
  });
  it('works while the round is WAITING for its first deploy (end_slot = u64::MAX)', async () => {
    const { crank, submitter } = setup({ board: board({ endSlot: U64_MAX }) });
    expect((await crank.tick()).status).toBe('worked');
    expect(submitter.batches).toHaveLength(1);
  });
});

describe('AC-4.2: balance below the per-round cost -> stop deploying, no error', () => {
  it('skips a depleted automation, deploys the rest, and logs no error', async () => {
    const low = automation({ balance: 5_999n });
    const ok = automation();
    const { crank, submitter, log } = setup({ automations: [low, ok] });
    const r = await crank.tick();
    expect(r).toMatchObject({ status: 'worked', planned: 1, ok: 1, failed: 0 });
    expect(submitter.batches[0]!.items.map((i) => i.authority.toBase58())).toEqual([ok.authority.toBase58()]);
    expect(log.lines.filter((l) => l.level === 'error')).toEqual([]);
  });
  it('all depleted: idle, no transaction, no error', async () => {
    const { crank, submitter, log } = setup({ automations: [automation({ balance: 0n })] });
    expect((await crank.tick()).status).toBe('idle');
    expect(submitter.batches).toHaveLength(0);
    expect(log.lines.some((l) => l.level === 'error')).toBe(false);
  });
});

describe('window handling', () => {
  it('window closed: no automation/miner reads at all (RPC economy), no tx', async () => {
    const { crank, chain, submitter } = setup({ slot: 1_239n }); // within the 8-slot end margin
    expect((await crank.tick()).status).toBe('window-closed');
    expect(chain.calls.automationsFor).toBe(0);
    expect(chain.calls.miners).toBe(0);
    expect(submitter.batches).toHaveLength(0);
  });
  it('nothing to do (everyone already deployed this round): idle', async () => {
    const a = automation();
    const deployed = new Array<bigint>(25).fill(0n);
    deployed[1] = 1_000n;
    const { crank, submitter } = setup({ automations: [a], miners: new Map([[a.authority.toBase58(), miner(a.authority, { roundId: 100n, deployed })]]) });
    expect((await crank.tick()).status).toBe('idle');
    expect(submitter.batches).toHaveLength(0);
  });
});

describe('failure isolation: one bad automation must not stop the others', () => {
  it('a failing batch is retried one automation at a time; the good ones still go through', async () => {
    const bad = automation();
    const good1 = automation();
    const good2 = automation();
    const submitter = fakeSubmitter((b) => (b.items.some((i) => i.authority.equals(bad.authority)) ? { kind: 'simulated-fail', err: { InstructionError: [1, 'Custom'] }, logs: ['x'] } : { kind: 'simulated-ok' }));
    const { crank, log } = setup({ automations: [good1, bad, good2] }, submitter);
    const r = await crank.tick();
    expect(r).toMatchObject({ status: 'worked', planned: 3, ok: 2, failed: 1 });
    expect(submitter.batches.map((b) => b.items.length)).toEqual([3, 1, 1, 1]); // batch, then each alone
    const skipped = log.lines.filter((l) => l.event === 'automation_skipped_this_round');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.data!.authority).toBe(bad.authority.toBase58());
  });
  it('a send failure is also contained', async () => {
    const submitter = fakeSubmitter(() => ({ kind: 'send-failed', error: 'blockhash expired' }));
    const { crank } = setup({ automations: [automation()] }, submitter);
    expect(await crank.tick()).toMatchObject({ status: 'worked', ok: 0, failed: 1 });
  });
});

describe('resilience: the loop never throws (AC-4.2) and recovers (AC-4.3)', () => {
  it.each(['board', 'slot', 'automations', 'miners'] as const)('RPC failure on %s -> status error, logged, no throw, health degrades', async (throwOn) => {
    const { crank, health, log, now } = setup({ throwOn });
    await expect(crank.tick()).resolves.toEqual({ status: 'error' });
    expect(log.lines.some((l) => l.event === 'tick_failed')).toBe(true);
    for (let i = 0; i < 3; i++) await crank.tick();
    expect(health.snapshot(now.t).ok).toBe(false);
  });
  it('recovers on the next tick once the RPC is back, with no manual reset', async () => {
    const { crank, state, submitter } = setup({ throwOn: 'board' });
    expect((await crank.tick()).status).toBe('error');
    state.throwOn = undefined;
    expect((await crank.tick()).status).toBe('worked');
    expect(submitter.batches).toHaveLength(1);
  });
  it('AC-4.3: a brand-new crank instance (restart) resumes with identical behaviour, with no local state', async () => {
    const first = setup();
    await first.crank.tick();
    const second = setup({ automations: first.state.automations, miners: first.state.miners }); // fresh process, same chain
    await second.crank.tick();
    expect(second.submitter.batches.map((b) => b.items.length)).toEqual(first.submitter.batches.map((b) => b.items.length));
    expect(second.submitter.batches[0]!.items.map((i) => i.authority.toBase58())).toEqual(first.submitter.batches[0]!.items.map((i) => i.authority.toBase58()));
  });
  it('does not re-send the same authority within one round while its own send is still settling (optimisation only)', async () => {
    const { crank, submitter } = setup(); // chain never changes: miners still look un-deployed (stale read)
    await crank.tick();
    await crank.tick();
    expect(submitter.batches).toHaveLength(1);
  });
  it('...but a NEW round deploys again immediately', async () => {
    const { crank, submitter, state } = setup();
    await crank.tick();
    state.board = board({ roundId: 101n });
    state.miners = new Map(state.automations.map((a) => [a.authority.toBase58(), miner(a.authority, { roundId: 100n, checkpointId: 100n })]));
    await crank.tick();
    expect(submitter.batches).toHaveLength(2);
    expect(submitter.contexts[1]!.roundId).toBe(101n);
  });
});

describe('E-10: executor balance', () => {
  it('reports balance and warns below 0.05 SOL', async () => {
    const { crank, health, log } = setup({ balance: 10_000_000n });
    await crank.tick();
    expect(health.snapshot(NOW).lowBalance).toBe(true);
    expect(log.lines.some((l) => l.event === 'low_executor_balance')).toBe(true);
  });
  it('balance is polled at most every 15 s, not every tick', async () => {
    const { crank, chain, now } = setup();
    await crank.tick();
    now.t += 2;
    await crank.tick();
    expect(chain.calls.balance).toBe(1);
    now.t += 20;
    await crank.tick();
    expect(chain.calls.balance).toBe(2);
  });
});

describe('dry-run guarantee', () => {
  it('the submitter used by default reports live=false and the loop reports DRY_RUN', async () => {
    const { crank, submitter, log } = setup();
    await crank.tick();
    expect(submitter.live).toBe(false);
    expect(log.lines.find((l) => l.event === 'round_worked')!.data!.mode).toBe('DRY_RUN');
  });
  it('executor identity in work items is the configured executor only', async () => {
    const { crank, submitter } = setup();
    await crank.tick();
    for (const ix of submitter.batches[0]!.instructions) for (const k of ix.keys) if (k.isSigner) expect(k.pubkey.equals(executor)).toBe(true);
  });
});
