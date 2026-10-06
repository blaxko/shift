// Chain reads for the setup flow. NFR-P3: one getMultipleAccounts call (+ two rent lookups, cached for the session).
import type { Connection, PublicKey } from '@solana/web3.js';
import { LayoutMismatch, SIZE, decode, pdas, type Automation, type Miner } from '@shift/codec';
import { appError, type AppError } from '../domain/errors';

export interface WalletChainState {
  balanceLamports: bigint;
  automation: Automation | null;
  miner: Miner | null;
  automationRentLamports: bigint;
  minerRentLamports: bigint;
}

const RENT_TTL_MS = 10 * 60 * 1000; // rent is a cluster parameter; re-read it regularly
let rentCache: { automation: bigint; miner: bigint; at: number } | null = null;

/** Live rent-exempt minimums (cached for the session). Throws if the RPC can't answer: we never show a guessed cost. */
async function rents(connection: Connection) {
  if (rentCache && Date.now() - rentCache.at < RENT_TTL_MS) return rentCache;
  const [a, m] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(SIZE.automation),
    connection.getMinimumBalanceForRentExemption(SIZE.miner),
  ]);
  rentCache = { automation: BigInt(a), miner: BigInt(m), at: Date.now() };
  return rentCache;
}

export type ChainResult = { ok: true; state: WalletChainState } | { ok: false; error: AppError };

export async function loadWalletChainState(connection: Connection, owner: PublicKey): Promise<ChainResult> {
  try {
    const [infos, rent] = await Promise.all([
      connection.getMultipleAccountsInfo([owner, pdas.automation(owner), pdas.miner(owner)], 'confirmed'),
      rents(connection),
    ]);
    const [ownerInfo, autoInfo, minerInfo] = infos;
    return {
      ok: true,
      state: {
        balanceLamports: BigInt(ownerInfo?.lamports ?? 0),
        automation: autoInfo ? decode.automation({ owner: autoInfo.owner, data: autoInfo.data }) : null,
        miner: minerInfo ? decode.miner({ owner: minerInfo.owner, data: minerInfo.data }) : null,
        automationRentLamports: rent.automation,
        minerRentLamports: rent.miner,
      },
    };
  } catch (e) {
    if (e instanceof LayoutMismatch) {
      // E-11: ORE changed a layout under us -> read-only Maintenance mode, no signing.
      return { ok: false, error: appError('LAYOUT_MISMATCH', 'ORE was updated. SHIFT is in read-only maintenance mode until it is updated too.', e) };
    }
    return { ok: false, error: appError('RPC_UNAVAILABLE', 'Could not reach the network. Check your connection and try again.', e) };
  }
}
