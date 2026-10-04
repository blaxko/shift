/**
 * READ-ONLY fixture dump (Phase 0.5, PRD §9.4 gate).
 * Fetches live ORE accounts (Automation, Miner, Board, Round, Treasury, Config) and writes
 * JSON to packages/codec/test/fixtures/ with slot + fetch date.
 * Uses only getProgramAccounts / getMultipleAccounts / getSlot. Never signs or sends. No keys.
 *
 *   RPC_URL=<url> npx tsx scripts/fetch-fixtures.ts
 *
 * Program IDs / seeds / sizes: docs/ORE_NOTES.md (ore-api @ 48c203bd).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const ORE = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv'); // api/src/lib.rs:19
const BOARD = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi'); // api/src/consts.rs
const TREASURY = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
const CONFIG = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');

// Account sizes = 8-byte steel discriminator + struct (derived in ORE_NOTES; asserted by the codec tests).
const AUTOMATION_SIZE = 160;
const WANT = 4;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'codec', 'test', 'fixtures');

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

interface AcctInfo {
  lamports: number;
  owner: string;
  data: [string, string];
  executable: boolean;
}
interface Multi {
  context: { slot: number };
  value: (AcctInfo | null)[];
}

async function getMany(keys: PublicKey[]): Promise<{ slot: number; accts: (AcctInfo | null)[] }> {
  const r = await rpc<Multi>('getMultipleAccounts', [
    keys.map((k) => k.toBase58()),
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  return { slot: r.context.slot, accts: r.value };
}

function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, ORE)[0];
}
const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

function save(kind: string, key: PublicKey, slot: number, a: AcctInfo, note?: string) {
  const file = join(outDir, `${kind}-${key.toBase58().slice(0, 8)}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        kind,
        pubkey: key.toBase58(),
        owner: a.owner,
        lamports: a.lamports,
        slot,
        fetchedAt: new Date().toISOString(),
        rpc: 'redacted',
        note,
        dataBase64: a.data[0],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`saved ${kind} ${key.toBase58()} (${Buffer.from(a.data[0], 'base64').length} bytes, slot ${slot})`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  // Singletons first: Board, Treasury, Config.
  const single = await getMany([BOARD, TREASURY, CONFIG]);
  const [board, treasury, config] = single.accts;
  if (!board || !treasury || !config) throw new Error('missing singleton account(s)');
  save('board', BOARD, single.slot, board);
  save('treasury', TREASURY, single.slot, treasury);
  save('config', CONFIG, single.slot, config);

  // Round accounts: current and the two before (older may be closed after expiry).
  const roundId = Buffer.from(board.data[0], 'base64').readBigUInt64LE(8); // after 8-byte discriminator
  const roundKeys = [roundId, roundId - 1n, roundId - 2n, roundId - 3n].map((id) => pda([Buffer.from('round'), u64le(id)]));
  const rounds = await getMany(roundKeys);
  let nRounds = 0;
  rounds.accts.forEach((a, i) => {
    if (a && nRounds < WANT) {
      save('round', roundKeys[i]!, rounds.slot, a, `round id ${roundId - BigInt(i)}`);
      nRounds++;
    }
  });

  // Automations: list pubkeys only (dataSlice length 0), then fetch a spread of them.
  const list = await rpc<{ pubkey: string }[]>('getProgramAccounts', [
    ORE.toBase58(),
    {
      encoding: 'base64',
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: AUTOMATION_SIZE }],
      commitment: 'finalized',
    },
  ]);
  console.log(`found ${list.length} automation-sized accounts`);
  const step = Math.max(1, Math.floor(list.length / (WANT * 3)));
  const picks = list.filter((_, i) => i % step === 0).slice(0, WANT * 3).map((x) => new PublicKey(x.pubkey));
  const autos = await getMany(picks);
  const authorities: PublicKey[] = [];
  let nAuto = 0;
  autos.accts.forEach((a, i) => {
    if (!a || nAuto >= WANT) return;
    save('automation', picks[i]!, autos.slot, a);
    authorities.push(new PublicKey(Buffer.from(a.data[0], 'base64').subarray(16, 48))); // authority @ offset 8+8
    nAuto++;
  });

  // Miners belonging to those automation authorities (guaranteed-real, in-use layouts).
  const minerKeys = authorities.map((p) => pda([Buffer.from('miner'), p.toBuffer()]));
  const miners = await getMany(minerKeys);
  miners.accts.forEach((a, i) => {
    if (a) save('miner', minerKeys[i]!, miners.slot, a, `authority ${authorities[i]!.toBase58()}`);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
