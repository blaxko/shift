// What the chain says about a wallet's ORE accounts (plain data; produced by services/chain.ts).
import type { Automation, Miner } from '@shift/codec';
import type { AppError } from './errors';

export interface WalletChainState {
  balanceLamports: bigint;
  automation: Automation | null;
  miner: Miner | null;
  /** Live rent-exempt minimums (never constants, see no-hardcoded-rent.test.ts). */
  automationRentLamports: bigint;
  minerRentLamports: bigint;
}

export type ChainResult = { ok: true; state: WalletChainState } | { ok: false; error: AppError };
