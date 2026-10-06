// F6 fetch layer. NFR-P3: <= 3 RPC calls per steady-state refresh; incremental memo scan using lastSeenSig (PRD F6).
//   call 1: getMultipleAccounts([wallet (for its balance), automation PDA, miner PDA])
//   call 2: getSignaturesForAddress(wallet, { until: lastSeenSig, limit: 100 })  (more pages only if a page is full)
//   call 3: only when a NEW clock-out (OUT) appeared: its transaction, to learn the ORE it delivered (cached forever)
// AC-6.2: with an empty cache the same code back-fills the last 60 days. AC-5.2: any failure returns the cached result.
import { LayoutMismatch, ORE_PROGRAM_ID, decode, extractMemoTexts, parseMemo, pdas, type ShiftInMemo, type ShiftOutMemo } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';
import type { RecentSig } from './clockInFlow';
import { appError, type AppError } from './errors';
import { reconcile } from './reconcile';
import type { CrankStatus, LocalHints, ReconcileResult } from './shift';
import { decodeResult, encodeResult } from './snapshotCodec';
import type { ShiftStore, StoredMemo } from './shiftStore';

export interface AccountLite {
  owner: PublicKey;
  data: Uint8Array;
  lamports?: number;
}

export interface RefreshRpc {
  accounts(keys: PublicKey[]): Promise<(AccountLite | null)[]>;
  signatures(owner: PublicKey, opts: { before?: string; until?: string; limit: number }): Promise<RecentSig[]>;
  /** ORE the wallet received in that transaction (see oreReceivedFromMeta), or null if unknown. */
  oreReceived(signature: string, owner: PublicKey): Promise<bigint | null>;
}

export interface RefreshDeps {
  rpc: RefreshRpc;
  store: ShiftStore;
  nowUnix(): number;
}

export interface RefreshInput {
  owner: PublicKey;
  crank: PublicKey | undefined;
  crankStatus: CrankStatus;
  local?: LocalHints;
}

export type RefreshOutcome =
  | { ok: true; result: ReconcileResult; balanceLamports: bigint; rpcCalls: number }
  | { ok: false; error: AppError; cached: { result: ReconcileResult; updatedAt: number } | null };

const BACKFILL_DAYS = 60; // AC-6.2
const INCREMENTAL_LIMIT = 100;
const BACKFILL_PAGE = 1000;
const MAX_PAGES = 20;
const LAST_SEEN = 'lastSeenSig';

export async function refresh(deps: RefreshDeps, input: RefreshInput): Promise<RefreshOutcome> {
  const wallet = input.owner.toBase58();
  const now = deps.nowUnix();
  let calls = 0;
  const rpc: RefreshRpc = {
    accounts: (k) => (calls++, deps.rpc.accounts(k)),
    signatures: (o, p) => (calls++, deps.rpc.signatures(o, p)),
    oreReceived: (s, o) => (calls++, deps.rpc.oreReceived(s, o)),
  };

  try {
    // ---- 1 + 2: accounts and new signatures, in parallel
    const lastSeen = await deps.store.getSetting(wallet, LAST_SEEN);
    const [infos, sigs] = await Promise.all([rpc.accounts([input.owner, pdas.automation(input.owner), pdas.miner(input.owner)]), scanNew(rpc, input.owner, lastSeen, now)]);

    const [walletInfo, autoInfo, minerInfo] = infos;
    const automation = autoInfo ? decode.automation({ owner: autoInfo.owner, data: autoInfo.data }) : null;
    const miner = minerInfo ? decode.miner({ owner: minerInfo.owner, data: minerInfo.data }) : null;
    if (autoInfo && !autoInfo.owner.equals(ORE_PROGRAM_ID)) throw new LayoutMismatch('automation', 'owner', 'unexpected owner');

    // ---- ledger: keep only strict SHIFT1 memos from successful transactions (E-20)
    const fresh: StoredMemo[] = [];
    for (const s of sigs) {
      if (s.err) continue;
      for (const text of extractMemoTexts(s.memo)) {
        const m = parseMemo(text);
        if (m) fresh.push({ signature: s.signature, blockTime: s.blockTime ?? now, kind: m.kind, raw: text });
      }
    }
    if (fresh.length) await deps.store.upsertMemos(wallet, fresh);

    // ---- stored ledger -> typed memos
    const stored = await deps.store.memos(wallet);
    const memos: (ShiftInMemo | ShiftOutMemo)[] = [];
    for (const row of stored) {
      const m = parseMemo(row.raw);
      if (!m) continue;
      memos.push(m.kind === 'IN' ? { v: 1, signature: row.signature, blockTime: row.blockTime, ...m } : { v: 1, signature: row.signature, blockTime: row.blockTime, ...m });
    }

    // ---- call 3 (rare): learn what a NEW clock-out delivered. At most one per refresh; the rest follow on later refreshes.
    const outs = memos.filter((m): m is ShiftOutMemo => m.kind === 'OUT');
    const claims = new Map<string, bigint>();
    let lookedUp = false;
    for (const o of outs) {
      let v = await deps.store.getClaim(wallet, o.signature);
      if (v === null && !lookedUp) {
        lookedUp = true;
        v = await rpc.oreReceived(o.signature, input.owner).catch(() => null);
        if (v !== null) await deps.store.setClaim(wallet, o.signature, v);
      }
      if (v !== null) claims.set(o.signature, v);
    }

    const result = reconcile({
      snapshot: { automation, miner },
      memos,
      owner: input.owner,
      crank: input.crank,
      crankStatus: input.crankStatus,
      oreReceivedByOutSignature: claims,
      local: input.local,
    });

    // Only after EVERYTHING succeeded do we advance the scan cursor and cache the result.
    if (sigs[0]) await deps.store.setSetting(wallet, LAST_SEEN, sigs[0].signature);
    await deps.store.saveSnapshot(wallet, encodeResult(result), now);
    return { ok: true, result, balanceLamports: BigInt(walletInfo?.lamports ?? 0), rpcCalls: calls };
  } catch (e) {
    const snap = await deps.store.loadSnapshot(wallet).catch(() => null);
    const cachedResult = snap ? decodeResult(snap.json) : null;
    const error =
      e instanceof LayoutMismatch
        ? appError('LAYOUT_MISMATCH', 'ORE was updated. SHIFT is in read-only maintenance mode until it is updated too.', e)
        : appError('RPC_UNAVAILABLE', "Couldn't refresh. Showing your last saved view.", e); // E-12
    return { ok: false, error, cached: snap && cachedResult ? { result: cachedResult, updatedAt: snap.updatedAt } : null };
  }
}

/** Newest-first signatures newer than `lastSeen`; with no cursor, back-fills the last BACKFILL_DAYS (AC-6.2). */
async function scanNew(rpc: RefreshRpc, owner: PublicKey, lastSeen: string | null, now: number): Promise<RecentSig[]> {
  const limit = lastSeen ? INCREMENTAL_LIMIT : BACKFILL_PAGE;
  const cutoff = now - BACKFILL_DAYS * 86_400;
  const all: RecentSig[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await rpc.signatures(owner, { before, until: lastSeen ?? undefined, limit });
    all.push(...batch);
    if (batch.length < limit) break; // a short page means we have reached the cursor / the start of history
    const oldest = batch[batch.length - 1]!;
    if (!lastSeen && oldest.blockTime !== null && oldest.blockTime < cutoff) break;
    before = oldest.signature;
  }
  return lastSeen ? all : all.filter((s) => s.blockTime === null || s.blockTime >= cutoff);
}
