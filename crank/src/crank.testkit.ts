// Test helpers only (excluded from the AC-4.5 source scan by the .testkit.ts suffix). Real mainnet fixtures + scripted fakes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ORE_PROGRAM_ID, decode, type Automation, type Board, type Miner } from '@shift/codec';
import type { ChainReader } from './chain';
import type { CrankConfig } from './config';
import { HealthState } from './health';
import type { Logger } from './log';
import type { SubmitContext, SubmitResult, Submitter } from './submit';
import type { Batch } from './batch';

const fx = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages', 'codec', 'test', 'fixtures');
const raw = (name: string) => Buffer.from((JSON.parse(readFileSync(join(fx, name), 'utf8')) as { dataBase64: string }).dataBase64, 'base64');
const AUTO_BASE: Automation = decode.automation({ owner: ORE_PROGRAM_ID, data: raw('automation-4dPdFJ7N.json') });
const MINER_BASE: Miner = decode.miner({ owner: ORE_PROGRAM_ID, data: raw('miner-9MbHiQxn.json') });
const BOARD_BASE: Board = decode.board({ owner: ORE_PROGRAM_ID, data: raw('board-BrcSxdp1.json') });

export const executor = Keypair.generate().publicKey;

export const automation = (over: Partial<Automation> = {}): Automation => ({
  ...AUTO_BASE,
  authority: Keypair.generate().publicKey,
  executor,
  strategy: 1n,
  amount: 1_000n,
  mask: 0b11111n, // 5 squares -> round cost 5_000 + fee 1_000
  fee: 1_000n,
  balance: 100_000n,
  ...over,
});

export const miner = (authority: PublicKey, over: Partial<Miner> = {}): Miner => ({
  ...MINER_BASE,
  authority,
  roundId: 99n,
  checkpointId: 99n,
  deployed: new Array<bigint>(25).fill(0n),
  ...over,
});

export const board = (over: Partial<Board> = {}): Board => ({ ...BOARD_BASE, roundId: 100n, startSlot: 1_000n, endSlot: 1_240n, ...over });

export const config = (over: Partial<CrankConfig> = {}): CrankConfig => ({
  rpcUrl: 'https://rpc.example',
  executorPubkey: executor,
  keypair: null,
  live: false,
  priorityFeeMicroLamports: 1_000,
  port: 8080,
  pollMs: 2_000,
  lowBalanceLamports: 50_000_000n,
  endMarginSlots: 8n,
  maxItemsPerTx: 5,
  ...over,
});

export const silentLog = (): Logger & { lines: { level: string; event: string; data?: Record<string, unknown> }[] } => {
  const lines: { level: string; event: string; data?: Record<string, unknown> }[] = [];
  const mk = (level: string) => (event: string, data?: Record<string, unknown>) => void lines.push({ level, event, data });
  return { info: mk('info'), warn: mk('warn'), error: mk('error'), lines };
};

export interface FakeChainState {
  slot: bigint;
  board: Board;
  automations: Automation[];
  miners: Map<string, Miner | null>;
  balance: bigint;
  throwOn?: 'board' | 'slot' | 'automations' | 'miners';
}

export function fakeChain(s: FakeChainState): ChainReader & { calls: Record<string, number> } {
  const calls: Record<string, number> = { slot: 0, board: 0, automationsFor: 0, miners: 0, balance: 0 };
  const guard = (k: NonNullable<FakeChainState['throwOn']>) => {
    if (s.throwOn === k) throw new Error(`rpc ${k} down`);
  };
  return {
    calls,
    slot: async () => (calls.slot!++, guard('slot'), s.slot),
    board: async () => (calls.board!++, guard('board'), s.board),
    automationsFor: async () => (calls.automationsFor!++, guard('automations'), s.automations),
    miners: async () => (calls.miners!++, guard('miners'), s.miners),
    balance: async () => (calls.balance!++, s.balance),
  };
}

export function fakeSubmitter(script: (batch: Batch, n: number) => SubmitResult = () => ({ kind: 'simulated-ok', unitsConsumed: 30_000 })): Submitter & { batches: Batch[]; contexts: SubmitContext[] } {
  const batches: Batch[] = [];
  const contexts: SubmitContext[] = [];
  return {
    live: false,
    batches,
    contexts,
    submit: async (b, ctx) => {
      batches.push(b);
      contexts.push(ctx);
      return script(b, batches.length);
    },
  };
}

export const newHealth = (cfg = config()) => new HealthState(cfg.executorPubkey, cfg.live, cfg.lowBalanceLamports, cfg.pollMs);
