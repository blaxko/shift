import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { HealthState, ROUND_SECONDS, STALLED_AFTER_SECONDS, startHealthServer } from './health';
import { U64_MAX } from './plan';
import { board, config, executor, newHealth } from './crank.testkit';

describe('HealthState (FR-4.1, E-10, AC-11.1)', () => {
  it('snapshot has the documented fields', () => {
    const h = newHealth();
    h.noteTick(1_000, true);
    h.noteBoard(board({ roundId: 7n }), 1_100n, 1_000);
    h.noteDeploy(7n, 1_001);
    h.setActive(3);
    h.setBalance(123_000_000n);
    expect(h.snapshot(1_005)).toEqual({
      ok: true,
      mode: 'DRY_RUN',
      crankPubkey: executor.toBase58(),
      lastRoundId: '7',
      lastRoundDeployedAt: 1_001,
      activeAutomations: 3,
      slotLag: 0,
      solBalance: 0.123,
      solBalanceLamports: '123000000',
      lowBalance: false,
      roundStalled: false,
      lastBoardAdvanceAt: 1_000,
      currentRoundId: '7',
    });
  });
  it('roundStalled: only after 3 rounds with no Board advance (234 s)', () => {
    const h = newHealth();
    h.noteBoard(board({ roundId: 7n }), 1_100n, 1_000);
    expect(STALLED_AFTER_SECONDS).toBe(3 * ROUND_SECONDS);
    expect(h.snapshot(1_000 + STALLED_AFTER_SECONDS).roundStalled).toBe(false);
    expect(h.snapshot(1_001 + STALLED_AFTER_SECONDS).roundStalled).toBe(true);
    h.noteBoard(board({ roundId: 8n }), 1_300n, 1_300); // Reset happened: advances
    expect(h.snapshot(1_301 + STALLED_AFTER_SECONDS - 100).roundStalled).toBe(false);
  });
  it('re-reading the same round does not reset the stall clock', () => {
    const h = newHealth();
    h.noteBoard(board({ roundId: 7n }), 1_100n, 1_000);
    h.noteBoard(board({ roundId: 7n }), 1_200n, 1_200);
    expect(h.snapshot(1_000 + STALLED_AFTER_SECONDS + 1).roundStalled).toBe(true);
  });
  it('E-10: low balance flagged below 0.05 SOL', () => {
    const h = newHealth();
    h.setBalance(49_999_999n);
    expect(h.snapshot(0).lowBalance).toBe(true);
    h.setBalance(50_000_000n);
    expect(h.snapshot(0).lowBalance).toBe(false);
  });
  it('slotLag: slots past the window end while no Reset has started the next round', () => {
    const h = newHealth();
    h.noteBoard(board({ endSlot: 1_240n }), 1_300n, 0);
    expect(h.snapshot(0).slotLag).toBe(60);
    h.noteBoard(board({ endSlot: U64_MAX }), 1_300n, 0); // waiting state: no lag
    expect(h.snapshot(0).slotLag).toBe(0);
  });
  it('ok goes false when ticks stop or fail repeatedly', () => {
    const h = newHealth();
    expect(h.snapshot(1_000).ok).toBe(false); // never ticked
    h.noteTick(1_000, true);
    expect(h.snapshot(1_010).ok).toBe(true);
    expect(h.snapshot(1_100).ok).toBe(false); // stale
    h.noteTick(1_100, false);
    h.noteTick(1_101, false);
    expect(h.snapshot(1_101).ok).toBe(true); // 2 failures tolerated
    h.noteTick(1_102, false);
    expect(h.snapshot(1_102).ok).toBe(false);
    h.noteTick(1_103, true);
    expect(h.snapshot(1_103).ok).toBe(true);
  });
  it('reports LIVE vs DRY_RUN honestly', () => {
    const c = config({ live: true });
    expect(new HealthState(c.executorPubkey, c.live, c.lowBalanceLamports, c.pollMs).snapshot(0).mode).toBe('LIVE');
  });
});

describe('GET /health (HTTP)', () => {
  let server: Server | null = null;
  afterEach(() => void server?.close());

  it('serves JSON on /health and 404s everything else', async () => {
    const h = newHealth();
    h.noteTick(Math.floor(Date.now() / 1000), true);
    server = startHealthServer(h, 0);
    await new Promise((r) => server!.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const ok = await fetch(`http://127.0.0.1:${port}/health`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('application/json');
    const body = (await ok.json()) as { ok: boolean; crankPubkey: string; mode: string };
    expect(body).toMatchObject({ ok: true, crankPubkey: executor.toBase58(), mode: 'DRY_RUN' });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/health`, { method: 'POST' })).status).toBe(404);
  });
  it('never exposes secrets: only public fields', async () => {
    const h = newHealth();
    server = startHealthServer(h, 0);
    await new Promise((r) => server!.once('listening', r));
    const text = await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/health`)).text();
    expect(text).not.toMatch(/secret|keypair|private/i);
  });
});
