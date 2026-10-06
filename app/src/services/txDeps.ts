// Real implementations of the flow's injected dependencies (RPC + wallet). Everything decision-making lives in domain/.
import type { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import type { FlowDeps } from '../domain/clockInFlow';
import { loadWalletChainState } from './chain';

export function makeFlowDeps(connection: Connection, owner: PublicKey, signAndSend: (tx: VersionedTransaction, minContextSlot: number) => Promise<string>): FlowDeps {
  return {
    loadState: () => loadWalletChainState(connection, owner),
    latestBlockhash: async () => {
      const r = await connection.getLatestBlockhashAndContext('confirmed');
      return { blockhash: r.value.blockhash, lastValidBlockHeight: r.value.lastValidBlockHeight, contextSlot: r.context.slot };
    },
    simulate: async (tx) => {
      // sigVerify:false — the wallet has not signed yet. Nothing is sent.
      const r = await connection.simulateTransaction(tx, { sigVerify: false, commitment: 'confirmed' });
      return { err: r.value.err, logs: r.value.logs, unitsConsumed: r.value.unitsConsumed };
    },
    signAndSend,
    signatureStatus: async (signature) => {
      const r = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
      const s = r.value[0];
      return s ? { confirmationStatus: s.confirmationStatus, err: s.err } : null;
    },
    blockHeight: () => connection.getBlockHeight('confirmed'),
    recentSignatures: async () => {
      const r = await connection.getSignaturesForAddress(owner, { limit: 10 }, 'confirmed');
      return r.map((x) => ({ signature: x.signature, blockTime: x.blockTime ?? null, memo: x.memo ?? null, err: x.err }));
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    nowUnix: () => Math.floor(Date.now() / 1000),
  };
}
