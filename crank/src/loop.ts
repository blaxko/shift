// F4 main loop. One `tick` = read chain -> plan -> batch -> submit. It NEVER throws (AC-4.2) and keeps no state that matters
// (AC-4.3): everything it needs is re-derived from the chain each tick. The few in-memory caches below are pure optimisations.
import type { Automation } from '@shift/codec';
import { packBatches, type Batch } from './batch';
import type { ChainReader } from './chain';
import type { CrankConfig } from './config';
import type { HealthState } from './health';
import type { Logger } from './log';
import { planRound, windowOpen, U64_MAX, type WorkItem } from './plan';
import type { Submitter } from './submit';

export interface LoopDeps {
  chain: ChainReader;
  submitter: Submitter;
  health: HealthState;
  log: Logger;
  nowUnix(): number;
  sleep(ms: number): Promise<void>;
}

export type TickStatus = 'window-closed' | 'idle' | 'worked' | 'error';
export interface TickResult {
  status: TickStatus;
  roundId?: bigint;
  planned?: number;
  ok?: number;
  failed?: number;
}

const AUTOMATION_CACHE_MS = 10_000;
const BALANCE_EVERY_MS = 15_000;
/** Don't resend the same authority within this window if the chain read hasn't caught up with our own send. */
const INFLIGHT_MS = 12_000;

export function createCrank(cfg: CrankConfig, deps: LoopDeps) {
  const { chain, submitter, health, log } = deps;
  let autoCache: { at: number; list: Automation[] } | null = null;
  let balanceAt = 0;
  const inflight = new Map<string, { roundId: bigint; at: number }>(); // pure optimisation, see header

  async function automations(nowMs: number): Promise<Automation[]> {
    if (autoCache && nowMs - autoCache.at < AUTOMATION_CACHE_MS) return autoCache.list;
    const list = await chain.automationsFor(cfg.executorPubkey);
    autoCache = { at: nowMs, list };
    return list;
  }

  async function submitIsolating(batch: Batch, roundId: bigint): Promise<{ ok: number; failed: number }> {
    const r = await submitter.submit(batch, { roundId });
    if (r.kind === 'sent' || r.kind === 'simulated-ok') {
      log.info(r.kind === 'sent' ? 'batch_sent' : 'batch_simulated_ok', { roundId, items: batch.items.length, ...(r.kind === 'sent' ? { signature: r.signature } : { unitsConsumed: r.unitsConsumed }) });
      return { ok: batch.items.length, failed: 0 };
    }
    // One bad automation must not stop the others in its batch: retry each alone.
    if (batch.items.length > 1) {
      log.warn('batch_failed_isolating', { roundId, items: batch.items.length, kind: r.kind });
      let ok = 0;
      let failed = 0;
      for (const it of batch.items) {
        const single = packBatches({ executor: cfg.executorPubkey, roundId, items: [it], priorityFeeMicroLamports: cfg.priorityFeeMicroLamports, maxItemsPerTx: 1 })[0]!;
        const s = await submitIsolating(single, roundId);
        ok += s.ok;
        failed += s.failed;
      }
      return { ok, failed };
    }
    const it = batch.items[0]!;
    log.warn('automation_skipped_this_round', { authority: it.authority.toBase58(), roundId, kind: r.kind, ...(r.kind === 'simulated-fail' ? { err: JSON.stringify(r.err), logs: r.logs } : { error: r.kind === 'send-failed' ? r.error : '' }) });
    return { ok: 0, failed: 1 };
  }

  async function tick(): Promise<TickResult> {
    const now = deps.nowUnix();
    const nowMs = now * 1000;
    try {
      const [slot, board] = await Promise.all([chain.slot(), chain.board()]);
      health.noteBoard(board, slot, now);

      if (nowMs - balanceAt > BALANCE_EVERY_MS) {
        balanceAt = nowMs;
        const bal = await chain.balance(cfg.executorPubkey);
        health.setBalance(bal);
        if (bal < cfg.lowBalanceLamports) log.warn('low_executor_balance', { lamports: bal }); // E-10
      }

      if (!windowOpen(board, slot, cfg.endMarginSlots)) {
        health.noteTick(now, true);
        return { status: 'window-closed', roundId: board.roundId };
      }

      const autos = await automations(nowMs);
      const miners = await chain.miners(autos.map((a) => a.authority));
      const plan = planRound({ board, automations: autos, miners, executor: cfg.executorPubkey });
      health.setActive(plan.activeCount);

      for (const [k, v] of inflight) if (nowMs - v.at > INFLIGHT_MS || v.roundId !== board.roundId) inflight.delete(k);
      const items: WorkItem[] = plan.items.filter((it) => !inflight.has(it.authority.toBase58()));

      if (items.length === 0) {
        health.noteTick(now, true);
        return { status: 'idle', roundId: board.roundId, planned: 0 };
      }

      const batches = packBatches({ executor: cfg.executorPubkey, roundId: board.roundId, items, priorityFeeMicroLamports: cfg.priorityFeeMicroLamports, maxItemsPerTx: cfg.maxItemsPerTx });
      let ok = 0;
      let failed = 0;
      for (const b of batches) {
        const r = await submitIsolating(b, board.roundId);
        ok += r.ok;
        failed += r.failed;
        if (r.ok > 0) for (const it of b.items) inflight.set(it.authority.toBase58(), { roundId: board.roundId, at: nowMs });
      }
      if (ok > 0) health.noteDeploy(board.roundId, now);
      log.info('round_worked', { roundId: board.roundId, planned: items.length, ok, failed, skipped: plan.skipped.length, mode: submitter.live ? 'LIVE' : 'DRY_RUN', endSlot: board.endSlot === U64_MAX ? 'waiting' : board.endSlot });
      health.noteTick(now, true);
      return { status: 'worked', roundId: board.roundId, planned: items.length, ok, failed };
    } catch (e) {
      log.error('tick_failed', { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
      health.noteTick(now, false);
      return { status: 'error' };
    }
  }

  async function run(signal: { aborted: boolean }): Promise<void> {
    while (!signal.aborted) {
      await tick();
      await deps.sleep(cfg.pollMs);
    }
  }

  return { tick, run };
}
