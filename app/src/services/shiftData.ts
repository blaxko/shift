// Real adapters for the refresh layer: expo-sqlite (cache) and the RPC connection. All decisions live in domain/refresh.ts.
import * as SQLite from 'expo-sqlite';
import { ORE_MINT } from '@shift/codec';
import type { Connection, PublicKey } from '@solana/web3.js';
import { oreReceivedFromMeta } from '../domain/oreReceived';
import type { RefreshRpc } from '../domain/refresh';
import { SqlShiftStore, type SqlDb } from '../domain/shiftStore';

let storePromise: Promise<SqlShiftStore> | null = null;

/** One shared SQLite-backed store per app run. The data is a CACHE: deleting it loses nothing the chain cannot rebuild (AC-6.2). */
export function getStore(): Promise<SqlShiftStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('shift.db');
      const sql: SqlDb = {
        exec: (q) => db.execAsync(q),
        run: async (q, p = []) => void (await db.runAsync(q, p)),
        all: <T,>(q: string, p: (string | number | null)[] = []) => db.getAllAsync<T>(q, p),
      };
      const store = new SqlShiftStore(sql);
      await store.init();
      return store;
    })().catch((e) => {
      storePromise = null; // allow a retry on the next refresh
      throw e;
    });
  }
  return storePromise;
}

export function makeRefreshRpc(connection: Connection): RefreshRpc {
  return {
    accounts: async (keys) => {
      const infos = await connection.getMultipleAccountsInfo(keys, 'confirmed');
      return infos.map((i) => (i ? { owner: i.owner, data: i.data, lamports: i.lamports } : null));
    },
    signatures: async (owner: PublicKey, opts) => {
      const r = await connection.getSignaturesForAddress(owner, { before: opts.before, until: opts.until, limit: opts.limit }, 'confirmed');
      return r.map((x) => ({ signature: x.signature, blockTime: x.blockTime ?? null, memo: x.memo ?? null, err: x.err }));
    },
    oreReceived: async (signature, owner) => {
      const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      return oreReceivedFromMeta(tx?.meta ?? null, owner.toBase58(), ORE_MINT.toBase58());
    },
  };
}
