// Sending. Two implementations behind one interface:
//   DryRunSubmitter — simulateTransaction ONLY (sigVerify:false). Needs no secret. Can never send. This is the default.
//   LiveSubmitter   — signs and sends. Reachable only when config.live (DRY_RUN=0 + ACKNOWLEDGE_LIVE); see config.ts / index.ts.
import type { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { toTransaction, type Batch } from './batch';
import type { Logger } from './log';

export interface SubmitContext {
  roundId: bigint;
}

export type SubmitResult =
  | { kind: 'simulated-ok'; unitsConsumed?: number }
  | { kind: 'simulated-fail'; err: unknown; logs: string[] }
  | { kind: 'sent'; signature: string }
  | { kind: 'send-failed'; error: string };

export interface Submitter {
  readonly live: boolean;
  submit(batch: Batch, ctx: SubmitContext): Promise<SubmitResult>;
}

/** The subset of web3.js Connection we use (lets tests inject fakes). */
export interface RpcLike {
  getLatestBlockhash(c?: 'confirmed' | 'processed'): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  simulateTransaction(tx: VersionedTransaction, cfg: { sigVerify: boolean; commitment: 'processed' | 'confirmed' }): Promise<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>;
  sendRawTransaction(raw: Uint8Array, opts: { skipPreflight: boolean; maxRetries: number }): Promise<string>;
  getSignatureStatuses(sigs: string[]): Promise<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>;
  getBlockHeight(c?: 'confirmed'): Promise<number>;
}

async function simulate(rpc: RpcLike, executor: PublicKey, batch: Batch): Promise<{ tx: VersionedTransaction; lastValid: number; result: SubmitResult | null; unitsConsumed?: number }> {
  const bh = await rpc.getLatestBlockhash('confirmed');
  const tx = toTransaction(executor, bh.blockhash, batch.instructions);
  const sim = await rpc.simulateTransaction(tx, { sigVerify: false, commitment: 'processed' });
  if (sim.value.err !== null) return { tx, lastValid: bh.lastValidBlockHeight, result: { kind: 'simulated-fail', err: sim.value.err, logs: (sim.value.logs ?? []).slice(-6) } };
  return { tx, lastValid: bh.lastValidBlockHeight, result: null, unitsConsumed: sim.value.unitsConsumed };
}

export class DryRunSubmitter implements Submitter {
  readonly live = false;
  constructor(
    private rpc: RpcLike,
    private executor: PublicKey,
  ) {}
  async submit(batch: Batch): Promise<SubmitResult> {
    const s = await simulate(this.rpc, this.executor, batch);
    return s.result ?? { kind: 'simulated-ok', unitsConsumed: s.unitsConsumed };
  }
}

export class LiveSubmitter implements Submitter {
  readonly live = true;
  constructor(
    private rpc: RpcLike,
    private keypair: Keypair,
    private log: Logger,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async submit(batch: Batch): Promise<SubmitResult> {
    // Simulate first: never burn a fee on something that would fail.
    const s = await simulate(this.rpc, this.keypair.publicKey, batch);
    if (s.result) return s.result;
    s.tx.sign([this.keypair]);
    const raw = s.tx.serialize();
    let signature = '';
    // Rebroadcast the same signed transaction until it confirms or its blockhash expires (priority fee + retries, FR-4 step 5).
    for (let i = 0; i < 60; i++) {
      try {
        signature = await this.rpc.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      } catch (e) {
        this.log.warn('send_error', { error: e instanceof Error ? e.message : String(e) });
      }
      await this.sleep(1_500);
      if (signature) {
        const st = (await this.rpc.getSignatureStatuses([signature])).value[0];
        if (st?.err) return { kind: 'send-failed', error: JSON.stringify(st.err) };
        if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { kind: 'sent', signature };
      }
      if ((await this.rpc.getBlockHeight('confirmed')) > s.lastValid) break;
    }
    return { kind: 'send-failed', error: 'blockhash expired before confirmation' };
  }
}
