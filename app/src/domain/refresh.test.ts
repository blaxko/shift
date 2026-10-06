import { DatabaseSync } from 'node:sqlite';
import { ORE_MINT, ORE_PROGRAM_ID, formatInMemo, formatOutMemo } from '@shift/codec';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { FUNDED_FOREIGN, REAL_MINER, crank, owner } from './chainFixtures.testkit';
import type { RecentSig } from './clockInFlow';
import { oreReceivedFromMeta } from './oreReceived';
import { refresh, type AccountLite, type RefreshDeps, type RefreshRpc } from './refresh';
import { decodeResult, encodeResult } from './snapshotCodec';
import { MemoryShiftStore, SqlShiftStore, type ShiftStore, type SqlDb } from './shiftStore';
import { reconcile } from './reconcile';

const NOW = 1_790_000_000;
const IN_SIG = '3Y' + 'a'.repeat(86); // valid base58 (no 0 O I l)
const OUT_SIG = '4Z' + 'b'.repeat(86);
const inText = formatInMemo({ role: 'balanced', budget: 20_000_000n, perSquare: 43_378n, squares: 10, feePerRound: 1_000n, setupLamports: 4_480_400n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-06', tzOffsetMin: 60 });
const outText = formatOutMemo({ inSigPrefix: IN_SIG.slice(0, 16) });
const memoField = (t: string) => `[${t.length}] ${t}`;
const sig = (signature: string, blockTime: number, memo: string | null, err: unknown = null): RecentSig => ({ signature, blockTime, memo, err });

// Account bytes for the Miner fixture, re-owned to this wallet: encode by re-using the fixture bytes is not possible after decode,
// so the fake serves the raw fixture accounts (any authority is fine: refresh only decodes and reads counters).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const fxRaw = (n: string): AccountLite => ({ owner: ORE_PROGRAM_ID, data: Buffer.from(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'codec', 'test', 'fixtures', n), 'utf8')).dataBase64, 'base64') });
const MINER_RAW = fxRaw('miner-9MbHiQxn.json');
const WALLET_RAW: AccountLite = { owner: PublicKey.default, data: new Uint8Array(0), lamports: 50_000_000 };

function fakeRpc(over: Partial<{ accounts: (AccountLite | null)[]; pages: RecentSig[][]; ore: bigint | null; throwOn: 'accounts' | 'signatures' | 'ore' }> = {}) {
  const calls = { accounts: 0, signatures: 0, ore: 0, sigOpts: [] as { before?: string; until?: string; limit: number }[] };
  let page = 0;
  const rpc: RefreshRpc = {
    accounts: async () => {
      calls.accounts++;
      if (over.throwOn === 'accounts') throw new Error('rpc down');
      return over.accounts ?? [WALLET_RAW, null, null];
    },
    signatures: async (_o, opts) => {
      calls.signatures++;
      calls.sigOpts.push(opts);
      if (over.throwOn === 'signatures') throw new Error('rpc down');
      return (over.pages ?? [[]])[Math.min(page++, (over.pages ?? [[]]).length - 1)]!;
    },
    oreReceived: async () => {
      calls.ore++;
      if (over.throwOn === 'ore') throw new Error('rpc down');
      return over.ore === undefined ? 1_234n : over.ore;
    },
  };
  return { rpc, calls };
}
const deps = (rpc: RefreshRpc, store: ShiftStore, now = NOW): RefreshDeps => ({ rpc, store, nowUnix: () => now });
const input = { owner, crank, crankStatus: 'ok' as const };

describe('refresh: call budget (NFR-P3)', () => {
  it('steady state with nothing new: exactly 2 RPC calls, and the wallet balance rides along in call 1', async () => {
    const store = new MemoryShiftStore();
    await store.setSetting(owner.toBase58(), 'lastSeenSig', 'CURSOR');
    const { rpc, calls } = fakeRpc();
    const r = await refresh(deps(rpc, store), input);
    expect(r.ok && r.rpcCalls).toBe(2);
    expect(r.ok && r.balanceLamports).toBe(50_000_000n);
    expect(calls.sigOpts[0]).toEqual({ before: undefined, until: 'CURSOR', limit: 100 }); // incremental: until lastSeenSig
  });
  it('a new clock-out adds ONE transaction lookup (3 calls), then it is cached: back to 2', async () => {
    const store = new MemoryShiftStore();
    await store.setSetting(owner.toBase58(), 'lastSeenSig', 'CURSOR');
    const first = fakeRpc({ pages: [[sig(OUT_SIG, NOW - 10, memoField(outText)), sig(IN_SIG, NOW - 500, memoField(inText))]] });
    const r1 = await refresh(deps(first.rpc, store), input);
    expect(r1.ok && r1.rpcCalls).toBe(3);
    expect(first.calls.ore).toBe(1);
    const second = fakeRpc();
    const r2 = await refresh(deps(second.rpc, store), input);
    expect(r2.ok && r2.rpcCalls).toBe(2);
    expect(second.calls.ore).toBe(0);
    expect(r2.ok && r2.result.history[0]!.oreEarned).toBe(1_234n); // survived in the claim cache
  });
  it('only one OUT lookup per refresh even if several clock-outs are missing', async () => {
    const store = new MemoryShiftStore();
    await store.setSetting(owner.toBase58(), 'lastSeenSig', 'CURSOR');
    const out2 = formatOutMemo({ inSigPrefix: 'bbbbbbbbbbbbbbbb' });
    const { rpc, calls } = fakeRpc({ pages: [[sig(OUT_SIG, NOW - 10, memoField(outText)), sig('OUT2', NOW - 20, memoField(out2))]] });
    await refresh(deps(rpc, store), input);
    expect(calls.ore).toBe(1);
  });
});

describe('refresh: ledger scan', () => {
  it('stores only strict SHIFT1 memos from SUCCESSFUL transactions (E-20)', async () => {
    const store = new MemoryShiftStore();
    const { rpc } = fakeRpc({
      pages: [[
        sig('GOOD', NOW - 5, memoField(inText)),
        sig('FAILED', NOW - 6, memoField(inText), { InstructionError: [0, 'x'] }),
        sig('LOOKALIKE', NOW - 7, memoField(inText.replace('SHIFT1', 'SHIFT2'))),
        sig('OTHERAPP', NOW - 8, '[5] hello'),
        sig('NOMEMO', NOW - 9, null),
      ]],
    });
    await refresh(deps(rpc, store), input);
    expect((await store.memos(owner.toBase58())).map((m) => m.signature)).toEqual(['GOOD']);
  });
  it('advances the cursor to the newest signature only after a successful refresh', async () => {
    const store = new MemoryShiftStore();
    const ok = fakeRpc({ pages: [[sig('NEWEST', NOW - 1, null), sig('OLDER', NOW - 2, null)]] });
    await refresh(deps(ok.rpc, store), input);
    expect(await store.getSetting(owner.toBase58(), 'lastSeenSig')).toBe('NEWEST');
    const bad = fakeRpc({ pages: [[sig('EVENNEWER', NOW, null)]], throwOn: 'accounts' });
    await refresh(deps(bad.rpc, store), input);
    expect(await store.getSetting(owner.toBase58(), 'lastSeenSig')).toBe('NEWEST'); // not advanced on failure: nothing is skipped next time
  });
  it('pages back when a page is full (heavy wallets) until a short page', async () => {
    const store = new MemoryShiftStore();
    await store.setSetting(owner.toBase58(), 'lastSeenSig', 'CURSOR');
    const full = Array.from({ length: 100 }, (_, i) => sig(`S${i}`, NOW - i, null));
    const { rpc, calls } = fakeRpc({ pages: [full, full.slice(0, 40)] });
    await refresh(deps(rpc, store), input);
    expect(calls.signatures).toBe(2);
    expect(calls.sigOpts[1]!.before).toBe('S99');
  });
});

describe('AC-6.2: reinstall / cleared data rebuilds from the last 60 days of memos', () => {
  it('empty cache: back-fills (limit 1000, no cursor) and reconstructs the shift, then caches a cursor', async () => {
    const store = new MemoryShiftStore();
    const { rpc, calls } = fakeRpc({ accounts: [WALLET_RAW, null, MINER_RAW], pages: [[sig(OUT_SIG, NOW - 100, memoField(outText)), sig(IN_SIG, NOW - 4_000, memoField(inText))]] });
    const r = await refresh(deps(rpc, store), input);
    expect(calls.sigOpts[0]).toEqual({ before: undefined, until: undefined, limit: 1000 });
    expect(r.ok && r.result.history.map((h) => h.status)).toEqual(['paid']);
    expect(await store.getSetting(owner.toBase58(), 'lastSeenSig')).toBe(OUT_SIG);
  });
  it('ignores memos older than 60 days on the back-fill', async () => {
    const store = new MemoryShiftStore();
    const { rpc } = fakeRpc({ pages: [[sig(IN_SIG, NOW - 61 * 86_400, memoField(inText))]] });
    const r = await refresh(deps(rpc, store), input);
    expect(r.ok && r.result.history).toEqual([]);
  });
  it('same chain, wiped cache vs warm cache => identical result (the cache is never the truth)', async () => {
    const pages = [[sig(OUT_SIG, NOW - 100, memoField(outText)), sig(IN_SIG, NOW - 4_000, memoField(inText))]];
    const accounts = [WALLET_RAW, null, MINER_RAW];
    const warm = new MemoryShiftStore();
    const a = await refresh(deps(fakeRpc({ accounts, pages }).rpc, warm), input);
    const b = await refresh(deps(fakeRpc({ accounts, pages }).rpc, new MemoryShiftStore()), input); // "reinstalled"
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(encodeResult(a.result)).toBe(encodeResult(b.result));
  });
  it('wallets are isolated: another wallet\'s memos never leak in', async () => {
    const store = new MemoryShiftStore();
    const other = Keypair.generate().publicKey;
    await refresh(deps(fakeRpc({ pages: [[sig(IN_SIG, NOW - 5, memoField(inText))]] }).rpc, store), { ...input, owner: other });
    const r = await refresh(deps(fakeRpc().rpc, store), input);
    expect(r.ok && r.result.history).toEqual([]);
  });
});

describe('AC-5.2 / E-12: failure shows the last cached values', () => {
  it('RPC down after a good refresh: returns the cached result with its timestamp', async () => {
    const store = new MemoryShiftStore();
    const good = fakeRpc({ accounts: [WALLET_RAW, null, MINER_RAW], pages: [[sig(IN_SIG, NOW - 500, memoField(inText))]] });
    const first = await refresh(deps(good.rpc, store, NOW), input);
    const down = await refresh(deps(fakeRpc({ throwOn: 'signatures' }).rpc, store, NOW + 600), input);
    expect(down.ok).toBe(false);
    if (!down.ok && first.ok) {
      expect(down.error.code).toBe('RPC_UNAVAILABLE');
      expect(down.error.userMessage).toMatch(/last saved view/);
      expect(down.cached?.updatedAt).toBe(NOW);
      expect(encodeResult(down.cached!.result)).toBe(encodeResult(first.result));
    }
  });
  it('no cache yet: failure reports cached=null (no invented numbers)', async () => {
    const r = await refresh(deps(fakeRpc({ throwOn: 'accounts' }).rpc, new MemoryShiftStore()), input);
    expect(r.ok === false && r.cached).toBeNull();
  });
  it('a corrupted cache is treated as no cache', async () => {
    const store = new MemoryShiftStore();
    await store.saveSnapshot(owner.toBase58(), '{not json', NOW);
    const r = await refresh(deps(fakeRpc({ throwOn: 'accounts' }).rpc, store), input);
    expect(r.ok === false && r.cached).toBeNull();
  });
  it('E-11: an ORE layout we do not understand -> maintenance error, not a crash', async () => {
    const garbage: AccountLite = { owner: ORE_PROGRAM_ID, data: new Uint8Array(100) };
    const r = await refresh(deps(fakeRpc({ accounts: [WALLET_RAW, garbage, null] }).rpc, new MemoryShiftStore()), input);
    expect(r.ok === false && r.error.code).toBe('LAYOUT_MISMATCH');
  });
  it('a failing OUT lookup does not fail the refresh: ORE is just unknown for now', async () => {
    const store = new MemoryShiftStore();
    const r = await refresh(deps(fakeRpc({ pages: [[sig(OUT_SIG, NOW - 10, memoField(outText)), sig(IN_SIG, NOW - 500, memoField(inText))]], throwOn: 'ore' }).rpc, store), input);
    expect(r.ok && r.result.history[0]!.oreEarned).toBeNull();
  });
});

describe('snapshot codec', () => {
  it('round-trips bigint fields exactly', () => {
    const res = reconcile({ snapshot: { automation: { ...FUNDED_FOREIGN, authority: owner, executor: crank }, miner: { ...REAL_MINER, authority: owner } }, memos: [{ v: 1, kind: 'IN', signature: IN_SIG, blockTime: NOW, role: 'safe', budget: 18_446_744_073_709_551_615n, perSquare: 1_000n, squares: 20, feePerRound: 1_000n, setupLamports: 0n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-06', tzOffsetMin: 0 }], owner, crank, crankStatus: 'ok', oreReceivedByOutSignature: new Map() });
    const back = decodeResult(encodeResult(res))!;
    expect(back).toEqual(res);
    expect(typeof back.history[0]!.budgetLamports).toBe('bigint');
  });
  it('garbage -> null', () => {
    expect(decodeResult('nope')).toBeNull();
    expect(decodeResult('{"x":1}')).toBeNull();
  });
});

describe('oreReceivedFromMeta: what the OUT transaction delivered', () => {
  const bal = (amount: string, o = owner.toBase58(), mint = ORE_MINT.toBase58()) => ({ mint, owner: o, uiTokenAmount: { amount } });
  it('post - pre for the wallet and the ORE mint', () => {
    expect(oreReceivedFromMeta({ preTokenBalances: [bal('1000')], postTokenBalances: [bal('51000')] }, owner.toBase58(), ORE_MINT.toBase58())).toBe(50_000n);
  });
  it('account created in the same tx (no pre entry)', () => {
    expect(oreReceivedFromMeta({ preTokenBalances: [], postTokenBalances: [bal('123456789')] }, owner.toBase58(), ORE_MINT.toBase58())).toBe(123_456_789n);
  });
  it('ignores other owners, other mints and the treasury side of the transfer', () => {
    const meta = {
      preTokenBalances: [bal('0'), bal('9999999', 'TREASURY'), bal('5', owner.toBase58(), 'OTHERMINT')],
      postTokenBalances: [bal('700'), bal('9999000', 'TREASURY'), bal('99', owner.toBase58(), 'OTHERMINT')],
    };
    expect(oreReceivedFromMeta(meta, owner.toBase58(), ORE_MINT.toBase58())).toBe(700n);
  });
  it('no ORE movement -> 0n; failed tx / no meta -> null (unknown, never a guess)', () => {
    expect(oreReceivedFromMeta({ preTokenBalances: [bal('5')], postTokenBalances: [bal('5')] }, owner.toBase58(), ORE_MINT.toBase58())).toBe(0n);
    expect(oreReceivedFromMeta({ err: { x: 1 }, postTokenBalances: [] }, owner.toBase58(), ORE_MINT.toBase58())).toBeNull();
    expect(oreReceivedFromMeta(null, owner.toBase58(), ORE_MINT.toBase58())).toBeNull();
    expect(oreReceivedFromMeta({ preTokenBalances: [] }, owner.toBase58(), ORE_MINT.toBase58())).toBeNull();
  });
});

// The REAL SQL, run against Node's built-in SQLite through the same SqlDb interface the app implements with expo-sqlite.
function nodeDb(): SqlDb {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => void db.exec(sql),
    run: async (sql, p = []) => void db.prepare(sql).run(...p),
    all: async <T,>(sql: string, p: (string | number | null)[] = []) => db.prepare(sql).all(...p) as T[],
  };
}

describe('SqlShiftStore (real SQL)', () => {
  const w1 = owner.toBase58();
  const w2 = PublicKey.default.toBase58();
  const mk = async () => {
    const s = new SqlShiftStore(nodeDb());
    await s.init();
    return s;
  };
  it('init is idempotent', async () => {
    const s = await mk();
    await expect(s.init()).resolves.toBeUndefined();
  });
  it('settings, memos (ordered), claims and snapshot round-trip; bigint claims exact', async () => {
    const s = await mk();
    await s.setSetting(w1, 'lastSeenSig', 'A');
    await s.setSetting(w1, 'lastSeenSig', 'B');
    expect(await s.getSetting(w1, 'lastSeenSig')).toBe('B');
    expect(await s.getSetting(w1, 'missing')).toBeNull();
    await s.upsertMemos(w1, [
      { signature: 'Z', blockTime: 20, kind: 'OUT', raw: 'o' },
      { signature: 'A', blockTime: 10, kind: 'IN', raw: 'i' },
      { signature: 'A', blockTime: 10, kind: 'IN', raw: 'i2' }, // upsert, not duplicate
    ]);
    expect((await s.memos(w1)).map((m) => [m.signature, m.raw])).toEqual([['A', 'i2'], ['Z', 'o']]);
    await s.setClaim(w1, 'Z', 18_446_744_073_709_551_615n);
    expect(await s.getClaim(w1, 'Z')).toBe(18_446_744_073_709_551_615n);
    expect(await s.getClaim(w1, 'nope')).toBeNull();
    await s.saveSnapshot(w1, '{"a":1}', 123);
    expect(await s.loadSnapshot(w1)).toEqual({ json: '{"a":1}', updatedAt: 123 });
  });
  it('wallets are isolated at the SQL level', async () => {
    const s = await mk();
    await s.upsertMemos(w1, [{ signature: 'X', blockTime: 1, kind: 'IN', raw: 'i' }]);
    await s.setSetting(w1, 'k', 'v');
    expect(await s.memos(w2)).toEqual([]);
    expect(await s.getSetting(w2, 'k')).toBeNull();
    expect(await s.loadSnapshot(w2)).toBeNull();
  });
  it('clear() wipes everything (the reinstall case)', async () => {
    const s = await mk();
    await s.upsertMemos(w1, [{ signature: 'X', blockTime: 1, kind: 'IN', raw: 'i' }]);
    await s.setSetting(w1, 'k', 'v');
    await s.clear();
    expect(await s.memos(w1)).toEqual([]);
    expect(await s.getSetting(w1, 'k')).toBeNull();
  });
  it('end to end: refresh() works identically on the SQL store and the memory store', async () => {
    const pages = [[sig(OUT_SIG, NOW - 100, memoField(outText)), sig(IN_SIG, NOW - 4_000, memoField(inText))]];
    const accounts = [WALLET_RAW, null, MINER_RAW];
    const a = await refresh(deps(fakeRpc({ accounts, pages }).rpc, await mk()), input);
    const b = await refresh(deps(fakeRpc({ accounts, pages }).rpc, new MemoryShiftStore()), input);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(encodeResult(a.result)).toBe(encodeResult(b.result));
  });
});

