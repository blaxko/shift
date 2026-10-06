import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { packBatches } from './batch';
import { automation, executor, silentLog } from './crank.testkit';
import { DryRunSubmitter, LiveSubmitter, type RpcLike } from './submit';

const batchOf = (ex = executor) => {
  const a = automation();
  return packBatches({ executor: ex, roundId: 100n, items: [{ authority: a.authority, automation: a, checkpointRoundId: null }], priorityFeeMicroLamports: 1000, maxItemsPerTx: 5 })[0]!;
};

function fakeRpc(over: Partial<{ simErr: unknown; statuses: ({ confirmationStatus?: string; err: unknown } | null)[]; heights: number[]; sendThrows: boolean }> = {}) {
  const calls = { send: 0, simulate: 0, sigVerify: [] as boolean[] };
  let st = 0;
  let h = 0;
  const rpc: RpcLike = {
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1_000 }),
    simulateTransaction: async (_tx, cfg) => {
      calls.simulate++;
      calls.sigVerify.push(cfg.sigVerify);
      return { value: { err: over.simErr ?? null, logs: ['log'], unitsConsumed: 31_000 } };
    },
    sendRawTransaction: async () => {
      calls.send++;
      if (over.sendThrows) throw new Error('rpc send error');
      return 'SIG';
    },
    getSignatureStatuses: async () => ({ value: [(over.statuses ?? [{ confirmationStatus: 'confirmed', err: null }])[Math.min(st++, (over.statuses ?? [1]).length - 1)] ?? null] }),
    getBlockHeight: async () => (over.heights ?? [0])[Math.min(h++, (over.heights ?? [0]).length - 1)]!,
  };
  return { rpc, calls };
}

describe('DryRunSubmitter: simulation only, structurally unable to send', () => {
  it('simulates with sigVerify:false and returns units; never calls sendRawTransaction', async () => {
    const { rpc, calls } = fakeRpc();
    const r = await new DryRunSubmitter(rpc, executor).submit(batchOf());
    expect(r).toEqual({ kind: 'simulated-ok', unitsConsumed: 31_000 });
    expect(calls.send).toBe(0);
    expect(calls.simulate).toBe(1);
    expect(calls.sigVerify).toEqual([false]);
  });
  it('simulation failure is reported with logs, still no send', async () => {
    const { rpc, calls } = fakeRpc({ simErr: { InstructionError: [0, 'InvalidAccountData'] } });
    const r = await new DryRunSubmitter(rpc, executor).submit(batchOf());
    expect(r).toMatchObject({ kind: 'simulated-fail', err: { InstructionError: [0, 'InvalidAccountData'] } });
    expect(calls.send).toBe(0);
  });
  it('is not live', () => {
    expect(new DryRunSubmitter(fakeRpc().rpc, executor).live).toBe(false);
  });
  it('the class has no reference to sendRawTransaction or signing', async () => {
    const src = DryRunSubmitter.toString();
    expect(src).not.toMatch(/sendRawTransaction|\.sign\(|serialize\(/);
  });
});

describe('LiveSubmitter (unreachable unless config.live): simulate -> sign -> send -> confirm', () => {
  const kp = Keypair.generate(); // ephemeral, test-only
  const sleep = async () => undefined;
  const mk = (rpc: RpcLike) => new LiveSubmitter(rpc, kp, silentLog(), sleep);

  it('simulation failure sends NOTHING (never burn a fee on a doomed tx)', async () => {
    const { rpc, calls } = fakeRpc({ simErr: 'AccountNotFound' });
    expect((await mk(rpc).submit(batchOf(kp.publicKey))).kind).toBe('simulated-fail');
    expect(calls.send).toBe(0);
  });
  it('sends once and returns the signature when confirmed', async () => {
    const { rpc, calls } = fakeRpc();
    expect(await mk(rpc).submit(batchOf(kp.publicKey))).toEqual({ kind: 'sent', signature: 'SIG' });
    expect(calls.send).toBe(1);
  });
  it('rebroadcasts while unconfirmed, stops at blockhash expiry', async () => {
    const { rpc, calls } = fakeRpc({ statuses: [null], heights: [900, 950, 1_001] });
    const r = await mk(rpc).submit(batchOf(kp.publicKey));
    expect(r).toEqual({ kind: 'send-failed', error: 'blockhash expired before confirmation' });
    expect(calls.send).toBe(3);
  });
  it('an on-chain failure is reported, not retried', async () => {
    const { rpc, calls } = fakeRpc({ statuses: [{ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'x'] } }] });
    expect((await mk(rpc).submit(batchOf(kp.publicKey))).kind).toBe('send-failed');
    expect(calls.send).toBe(1);
  });
  it('is live', () => {
    expect(mk(fakeRpc().rpc).live).toBe(true);
  });
});
