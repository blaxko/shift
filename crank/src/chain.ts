// Read-only chain access for the crank. No writes, no signing here.
import { BOARD_ADDRESS, LayoutMismatch, ORE_PROGRAM_ID, SIZE, decode, pdas, type Automation, type Board, type Miner } from '@shift/codec';
import type { Connection, PublicKey } from '@solana/web3.js';
import type { Logger } from './log';

/** Byte offset of Automation.executor (8-byte discriminator + amount 8 + authority 32 + balance 8). ORE_NOTES §5. */
export const EXECUTOR_OFFSET = 56;

export interface ChainReader {
  slot(): Promise<bigint>;
  board(): Promise<Board>;
  /** All Automation accounts whose executor is `executor` (getProgramAccounts with dataSize + memcmp). */
  automationsFor(executor: PublicKey): Promise<Automation[]>;
  /** Miner accounts by authority (base58); null when the account doesn't exist. */
  miners(authorities: PublicKey[]): Promise<Map<string, Miner | null>>;
  balance(pk: PublicKey): Promise<bigint>;
}

export function rpcChain(connection: Connection, log: Logger): ChainReader {
  return {
    slot: async () => BigInt(await connection.getSlot('confirmed')),

    board: async () => {
      const a = await connection.getAccountInfo(BOARD_ADDRESS, 'confirmed');
      if (!a) throw new Error('board account missing');
      return decode.board({ owner: a.owner, data: a.data });
    },

    automationsFor: async (executor) => {
      const accts = await connection.getProgramAccounts(ORE_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ dataSize: SIZE.automation }, { memcmp: { offset: EXECUTOR_OFFSET, bytes: executor.toBase58() } }],
      });
      const out: Automation[] = [];
      for (const { pubkey, account } of accts) {
        try {
          out.push(decode.automation({ owner: account.owner, data: account.data }));
        } catch (e) {
          // E-11: a layout we don't understand. Skip THIS account, loudly; never crash the loop.
          if (e instanceof LayoutMismatch) log.error('layout_mismatch', { account: pubkey.toBase58(), reason: e.reason });
          else throw e;
        }
      }
      return out;
    },

    miners: async (authorities) => {
      const out = new Map<string, Miner | null>();
      for (let i = 0; i < authorities.length; i += 100) {
        const chunk = authorities.slice(i, i + 100);
        const infos = await connection.getMultipleAccountsInfo(chunk.map((a) => pdas.miner(a)), 'confirmed');
        chunk.forEach((auth, j) => {
          const info = infos[j];
          try {
            out.set(auth.toBase58(), info ? decode.miner({ owner: info.owner, data: info.data }) : null);
          } catch (e) {
            if (e instanceof LayoutMismatch) {
              log.error('layout_mismatch', { account: `miner:${auth.toBase58()}`, reason: e.reason });
              out.set(auth.toBase58(), null); // treated as "no miner": skipped, never paid for
            } else throw e;
          }
        });
      }
      return out;
    },

    balance: async (pk) => BigInt(await connection.getBalance(pk, 'confirmed')),
  };
}
