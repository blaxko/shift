/**
 * READ-ONLY. Measures the real ORE round cycle from the last ~50 rounds (ROUND_SECONDS, ORE_NOTES §7.6a).
 *
 * Method: Round.expires_at = end_slot + ONE_DAY_SLOTS (deploy.rs:50), so end_slot is recoverable from each
 * live Round account. Cycle (slots) = end_slot[n+1] - end_slot[n]  (includes intermission, waiting for Reset and
 * for the first deploy). Slots -> seconds via getBlockTime on the first/last end slots.
 *
 *   RPC_URL=<url> npx tsx scripts/measure-rounds.ts
 */
import { PublicKey } from '@solana/web3.js';
import { ORE_PROGRAM_ID, decode, pdas } from '../packages/codec/src';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
// consts.rs:26-35: ONE_MINUTE_SLOTS=200, ONE_HOUR_SLOTS=60*200, ONE_DAY_SLOTS=24*ONE_HOUR_SLOTS
const DAY_SLOTS = 24n * 60n * 200n;
const N = 50;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await res.json()) as { result: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function blockTime(slot: number): Promise<number> {
  for (let d = 0; d < 20; d++) {
    try {
      const t = await rpc<number | null>('getBlockTime', [slot + d]);
      if (t) return t; // skipped-slot drift of <= 20 slots (~5 s) is negligible over a ~1 h span
    } catch {
      /* skipped slot — try the next */
    }
  }
  throw new Error(`no block time near ${slot}`);
}

function pct(a: number[], p: number) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

async function main() {
  const board = decode.board({
    owner: ORE_PROGRAM_ID,
    data: Buffer.from(
      (await rpc<{ value: { data: [string, string] } }>('getAccountInfo', [pdas.board().toBase58(), { encoding: 'base64' }])).value.data[0],
      'base64',
    ),
  });
  const nowSlot = BigInt(await rpc<number>('getSlot', [{ commitment: 'finalized' }]));
  const ids = Array.from({ length: N + 5 }, (_, i) => board.roundId - BigInt(i));
  const keys = ids.map((id) => pdas.round(id).toBase58());
  const res = await rpc<{ value: ({ owner: string; data: [string, string] } | null)[] }>('getMultipleAccounts', [keys, { encoding: 'base64' }]);
  const ends: { id: bigint; end: bigint }[] = [];
  res.value.forEach((a) => {
    if (!a) return;
    const r = decode.round({ owner: new PublicKey(a.owner), data: Buffer.from(a.data[0], 'base64') });
    if (r.expiresAt === 0xffffffffffffffffn) return; // not started yet
    const end = r.expiresAt - DAY_SLOTS;
    if (end < nowSlot - 64n) ends.push({ id: r.id, end }); // only rounds that have already ended
  });
  ends.sort((a, b) => Number(a.id - b.id));
  const cycles: number[] = [];
  for (let i = 1; i < ends.length; i++) {
    if (ends[i]!.id - ends[i - 1]!.id === 1n) cycles.push(Number(ends[i]!.end - ends[i - 1]!.end));
  }
  const first = ends[0]!;
  const last = ends[ends.length - 1]!;
  const [t0, t1] = [await blockTime(Number(first.end)), await blockTime(Number(last.end))];
  const slotsSpan = Number(last.end - first.end);
  const secPerSlot = (t1 - t0) / slotsSpan;
  const mean = cycles.reduce((a, b) => a + b, 0) / cycles.length;
  const out = {
    measuredAt: new Date().toISOString(),
    currentRound: board.roundId.toString(),
    roundsUsed: ends.length,
    consecutivePairs: cycles.length,
    cycleSlots: { min: Math.min(...cycles), p50: pct(cycles, 0.5), mean: +mean.toFixed(1), p90: pct(cycles, 0.9), max: Math.max(...cycles) },
    secPerSlot: +secPerSlot.toFixed(4),
    cycleSeconds: { p50: +(pct(cycles, 0.5) * secPerSlot).toFixed(1), mean: +(mean * secPerSlot).toFixed(1), p90: +(pct(cycles, 0.9) * secPerSlot).toFixed(1) },
    wallClockSpanSeconds: t1 - t0,
    wallClockPerRoundSeconds: +((t1 - t0) / (Number(last.id - first.id))).toFixed(1),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
