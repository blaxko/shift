// Test helpers only (excluded from the no-hardcoded-rent scan by its .testkit.ts suffix). Real mainnet fixtures + scripted fakes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ORE_PROGRAM_ID, decode, type Automation, type Miner } from '@shift/codec';
import type { ChainResult, WalletChainState } from './chainState';
import type { FlowDeps, RecentSig, SigStatus, SimOutcome } from './clockInFlow';
import { planShift, type ShiftPlan } from './planShift';

// TEST DATA ONLY: mainnet rent on 2026-10-06 = 5080 lamports/byte x (size + 128). The app reads rent live.
export const RENT_AUTOMATION = (160n + 128n) * 5080n;
export const RENT_MINER = (752n + 128n) * 5080n;

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'codec', 'test', 'fixtures');
const load = (name: string) => Buffer.from((JSON.parse(readFileSync(join(dir, name), 'utf8')) as { dataBase64: string }).dataBase64, 'base64');
export const fxAutomation = (name: string): Automation => decode.automation({ owner: ORE_PROGRAM_ID, data: load(name) });
export const fxMiner = (name: string): Miner => decode.miner({ owner: ORE_PROGRAM_ID, data: load(name) });

export const IDLE_SHELL = fxAutomation('automation-2fFYVW8S.json'); // balance 0, executor == owner
export const FUNDED_FOREIGN = fxAutomation('automation-4dPdFJ7N.json'); // funded, other executor
export const REAL_MINER = fxMiner('miner-9MbHiQxn.json');

export const crank = Keypair.generate().publicKey;
export const owner = Keypair.generate().publicKey;

export const plan = (budget = 20_000_000n, role: 'safe' | 'balanced' | 'sniper' = 'balanced', minutes = 60): ShiftPlan => {
  const r = planShift({ role, budgetLamports: budget, lengthMinutes: minutes, nowUnix: 1_790_000_000 });
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
};

export const state = (over: Partial<WalletChainState> = {}): WalletChainState => ({
  balanceLamports: 100_000_000n,
  automation: null,
  miner: null,
  automationRentLamports: RENT_AUTOMATION,
  minerRentLamports: RENT_MINER,
  ...over,
});

export const BLOCKHASH = '11111111111111111111111111111111';

export interface Calls {
  loadState: number;
  simulate: number;
  signAndSend: number;
  txs: import('@solana/web3.js').VersionedTransaction[];
  sleeps: number;
}

/**
 * Scripted dependencies. Time is virtual: `blockHeight()` advances by `heightStep` each call, `sleep` is free.
 * Every override can be a function so tests can script sequences.
 */
export function makeDeps(
  over: Partial<{
    states: ChainResult[]; // returned in order, last one repeats
    sim: SimOutcome;
    signAndSend: (tx: import('@solana/web3.js').VersionedTransaction) => Promise<string>;
    status: (sig: string, call: number) => SigStatus | null;
    recent: RecentSig[];
    lastValid: number;
    startHeight: number;
    heightStep: number;
    nowUnix: number;
  }> = {},
): { deps: FlowDeps; calls: Calls } {
  const calls: Calls = { loadState: 0, simulate: 0, signAndSend: 0, txs: [], sleeps: 0 };
  const states = over.states ?? [{ ok: true, state: state() }];
  let height = over.startHeight ?? 1000;
  let statusCalls = 0;
  const deps: FlowDeps = {
    loadState: async () => states[Math.min(calls.loadState++, states.length - 1)]!,
    latestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: over.lastValid ?? 1150, contextSlot: 5_000 }),
    simulate: async () => {
      calls.simulate++;
      return over.sim ?? { err: null, logs: [], unitsConsumed: 57_000 };
    },
    signAndSend: async (tx) => {
      calls.signAndSend++;
      calls.txs.push(tx);
      return over.signAndSend ? over.signAndSend(tx) : 'SIG_1';
    },
    signatureStatus: async (sig) => (over.status ? over.status(sig, statusCalls++) : { confirmationStatus: 'confirmed', err: null }),
    blockHeight: async () => {
      const h = height;
      height += over.heightStep ?? 10;
      return h;
    },
    recentSignatures: async () => over.recent ?? [],
    sleep: async () => {
      calls.sleeps++;
    },
    nowUnix: () => over.nowUnix ?? 1_790_000_000,
  };
  return { deps, calls };
}

export const input = (p: ShiftPlan = plan(), who: PublicKey = owner) => ({ owner: who, crank, plan: p, localDate: '2026-10-06', tzOffsetMin: 60 });
