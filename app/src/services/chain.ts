// Chain reads for the setup flow. NFR-P3: one getMultipleAccounts call (+ two rent lookups, cached for the session).
import type { Connection, PublicKey } from '@solana/web3.js';
import { LayoutMismatch, SIZE, decode, pdas, type Automation, type Miner } from '@shift/codec';
import { RENT_AUTOMATION_FALLBACK, RENT_MINER_FALLBACK } from '../config/planning';
import { appError, type AppError } from '../domain/errors';

export interface WalletChainState {
  balanceLamports: bigint;
  automation: Automation | null;
  miner: Miner | null;
  automationRentLamports: bigint;
  minerRentLamports: bigint;
}

let rentCache: { automation: bigint; miner: bigint } | null = null;

async function rents(connection: Connection) {
  if (rentCache) return rentCache;
  try {
    const [a, m] = await Promise.all([
      connection.getMinimumBalanceForRentExemption(SIZE.automation),
      connection.getMinimumBalanceForRentExemption(SIZE.miner),
    ]);
    rentCache = { automation: BigInt(a), miner: BigInt(m) };
  } catch {
    return { automation: RENT_AUTOMATION_FALLBACK, miner: RENT_MINER_FALLBACK }; // not cached: try again next time
  }
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
