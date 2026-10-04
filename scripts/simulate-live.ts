/**
 * READ-ONLY. Runs codec instruction builders through `simulateTransaction` against the real ORE program on mainnet.
 * Nothing is signed (sigVerify:false, no keys exist or are needed) and nothing is sent.
 *
 *   RPC_URL=<url> npx tsx scripts/simulate-live.ts
 *
 * Cases:
 *  A  idle shell (balance 0, executor == owner): [stopAutomation, automate] in ONE tx   (PRD v1.1 FR-3.1 / E-6)
 *  B  fresh wallet clock-in: [automate, memo]                                          (AC-3.1/3.2 byte-level proof)
 *  C  claimOre / claimSol / checkpoint for a real miner                                (F7 builders)
 *  D  executorDeploy as a real automation's executor                                   (F4 account list incl. entropy)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  automate,
  checkpoint,
  claimOre,
  claimSol,
  decode,
  executorDeploy,
  formatInMemo,
  ORE_PROGRAM_ID,
  pdas,
  shiftMemo,
  stopAutomation,
} from '../packages/codec/src';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const fxDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'codec', 'test', 'fixtures');
const fixtures = (kind: string) =>
  readdirSync(fxDir)
    .filter((f) => f.startsWith(kind + '-'))
    .map((f) => JSON.parse(readFileSync(join(fxDir, f), 'utf8')) as { pubkey: string; dataBase64: string });

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = (await res.json()) as { result?: T; error?: { message: string; code: number } };
    if (j.error?.code === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as T;
  }
  throw new Error(`${method}: rate limited`);
}

interface SimResult {
  value: { err: unknown; logs: string[] | null; unitsConsumed?: number; accounts?: ({ data: [string, string]; lamports: number; owner: string } | null)[] };
}

async function simulate(feePayer: PublicKey, ixs: TransactionInstruction[], watch: PublicKey[] = []) {
  const tx = new Transaction({ feePayer, recentBlockhash: '11111111111111111111111111111111' });
  tx.add(...ixs);
  if (process.env.SHOW_KEYS) console.log('   tx accounts:', tx.compileMessage().accountKeys.map((k, i) => `${i}:${k.toBase58().slice(0, 6)}`).join(' '));
  const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const res = await rpc<SimResult>('simulateTransaction', [
    b64,
    {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: 'processed',
      ...(watch.length ? { accounts: { encoding: 'base64', addresses: watch.map((k) => k.toBase58()) } } : {}),
    },
  ]);
  return res.value;
}

function report(name: string, v: SimResult['value']) {
  const ok = v.err === null;
  console.log(`\n=== ${name}: ${ok ? 'SIMULATION OK' : 'SIMULATION FAILED'}  err=${JSON.stringify(v.err)}  CU=${v.unitsConsumed ?? '-'}`);
  for (const l of (v.logs ?? []).slice(-8)) console.log('   ', l);
  return ok;
}

const lamports = async (k: PublicKey) => (await rpc<{ value: number }>('getBalance', [k.toBase58()])).value;
const exists = async (k: PublicKey) => (await rpc<{ value: unknown }>('getAccountInfo', [k.toBase58(), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value !== null;

/** A funded system account used ONLY as the (unsigned, simulated) fee payer. */
const PAYER = new PublicKey('DyB4Kv6V613gp2LWQTq1dwDYHGKuUEoDHnCouGUtxFiX');
/** Simulated top-up so a zero-balance fixture owner behaves like a real user holding SOL. */
const fund = (to: PublicKey, lamports: number) => SystemProgram.transfer({ fromPubkey: PAYER, toPubkey: to, lamports });

async function main() {
  const crank = Keypair.generate().publicKey; // public half only; the secret is never kept or printed
  const results: Record<string, boolean> = {};

  // ---- A: idle shell
  const shell = fixtures('automation')
    .map((f) => ({ f, a: decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(f.dataBase64, 'base64') }) }))
    .find(({ a }) => a.balance === 0n && a.executor.equals(a.authority));
  if (!shell) throw new Error('no idle-shell fixture');
  const owner = shell.a.authority;
  const live = await rpc<{ value: { data: [string, string] } | null }>('getAccountInfo', [pdas.automation(owner).toBase58(), { encoding: 'base64' }]);
  const stillIdle = live.value ? decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(live.value.data[0], 'base64') }) : null;
  console.log(`A: shell owner ${owner.toBase58()} lamports=${await lamports(owner)} automation still idle: ${!!stillIdle && stillIdle.balance === 0n && stillIdle.executor.equals(owner)}`);
  const deposit = 20_000_000n;
  const a = await simulate(
    PAYER,
    [fund(owner, 30_000_000), stopAutomation(owner), automate({ authority: owner, executor: crank, amount: 1000n, deposit, fee: 1000n, mask: 0b11111n, reload: false })],
    [pdas.automation(owner)],
  );
  results['A idle-shell close+Automate in ONE tx'] = report('A idle shell: [stop, automate]', a);
  if (a.accounts?.[0]) {
    const post = decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(a.accounts[0].data[0], 'base64') });
    console.log(`   post-state: balance=${post.balance} executor==crank:${post.executor.equals(crank)} strategy=${post.strategy} reload=${post.reload} amount=${post.amount} mask=${post.mask} fee=${post.fee}`);
  }
  // control: what happens WITHOUT the stop (documents the overwrite behaviour that FR-3.1 guards against)
  const aControl = await simulate(PAYER, [fund(owner, 30_000_000), automate({ authority: owner, executor: crank, amount: 1000n, deposit, fee: 1000n, mask: 0b11111n, reload: false })]);
  report('A-control (automate only, overwrites shell; not allowed by the app without confirmation)', aControl);

  // ---- B: fresh wallet clock-in (an arbitrary funded system account with no ORE automation/miner)
  const candidates = ['DyB4Kv6V613gp2LWQTq1dwDYHGKuUEoDHnCouGUtxFiX', 'HBUh9g46wk2X89CvaNN15UmsznP59rh6od1h8JwYAopk'].map((s) => new PublicKey(s));
  let fresh: PublicKey | null = null;
  for (const c of candidates) if ((await lamports(c)) > 50_000_000 && !(await exists(pdas.automation(c))) && !(await exists(pdas.miner(c)))) { fresh = c; break; }
  if (fresh) {
    const memo = formatInMemo({ role: 'balanced', budget: deposit, perSquare: 1000n, squares: 5, feePerRound: 1000n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-04', tzOffsetMin: 60 });
    const b = await simulate(fresh, [automate({ authority: fresh, executor: crank, amount: 1000n, deposit, fee: 1000n, mask: 0b11111n, reload: false }), shiftMemo(fresh, memo)], [pdas.automation(fresh)]);
    results['B fresh clock-in [automate, memo]'] = report('B fresh wallet: [automate, memo]', b);
    if (b.accounts?.[0]) {
      const post = decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(b.accounts[0].data[0], 'base64') });
      console.log(`   AC-3.2 post-state: balance=${post.balance} (== deposit ${deposit}) executor==crank:${post.executor.equals(crank)} strategy=${post.strategy} reload=${post.reload}`);
    }
  } else console.log('B: no suitable fresh funded wallet found; skipped');

  // ---- C: claims + checkpoint for a real miner (signer must be the miner authority for claims)
  const miners = fixtures('miner').map((f) => decode.miner({ owner: ORE_PROGRAM_ID, data: Buffer.from(f.dataBase64, 'base64') }));
  const rich = miners.find((m) => m.refinedOre + m.rewardsOre > 0n) ?? miners[0]!;
  const au = rich.authority;
  const c1 = await simulate(PAYER, [fund(au, 10_000_000), claimOre(au)]);
  results['C claimOre'] = report(`C claimOre (authority ${au.toBase58().slice(0, 6)}…)`, c1);
  const c2 = await simulate(PAYER, [claimSol(au)]);
  results['C claimSol'] = report('C claimSol', c2);
  const boardAcc = await rpc<{ value: { data: [string, string] } }>('getAccountInfo', [pdas.board().toBase58(), { encoding: 'base64' }]);
  const board = decode.board({ owner: ORE_PROGRAM_ID, data: Buffer.from(boardAcc.value.data[0], 'base64') });
  const c3 = await simulate(PAYER, [checkpoint({ signer: PAYER, authority: au, roundId: rich.roundId })]);
  results['C checkpoint (any signer)'] = report(`C checkpoint for miner round ${rich.roundId} (board round ${board.roundId})`, c3);

  // ---- D: executorDeploy as the real executor of a live automation
  const auto = fixtures('automation')
    .map((f) => decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(f.dataBase64, 'base64') }))
    .find((x) => x.balance > 0n);
  if (auto) {
    // Deploy only runs inside an open round window (deploy.rs:33). Retry until the simulation gets past that check,
    // re-reading the board each time, so the later account/seed checks (deploy.rs:34-77) are actually exercised.
    let d: SimResult['value'] | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const b = await rpc<{ value: { data: [string, string] } }>('getAccountInfo', [pdas.board().toBase58(), { encoding: 'base64', commitment: 'processed' }]);
      const cur = decode.board({ owner: ORE_PROGRAM_ID, data: Buffer.from(b.value.data[0], 'base64') });
      d = await simulate(PAYER, [executorDeploy({ executor: auto.executor, authority: auto.authority, roundId: cur.roundId, amount: auto.amount, mask: auto.mask })]);
      const windowClosed = (d.logs ?? []).some((l) => l.includes('deploy.rs:33') || l.includes('deploy.rs:35')); // closed window, or round rolled over mid-flight
      if (!windowClosed) break;
      console.log(`   D attempt ${attempt + 1}: round window closed (deploy.rs:33), retrying…`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    // Pass criterion: the ORE program itself ran Deploy to success. A trailing tx-level InsufficientFundsForRent on the
    // LEGACY fixture automation (its lamports are below today's rent for 160 bytes) is not a builder problem; reported below.
    const oreRan = (d!.logs ?? []).some((l) => /Round #[0-9]+: deploying/.test(l)) && (d!.logs ?? []).some((l) => l.includes(`Program ${ORE_PROGRAM_ID.toBase58()} success`));
    const legacyRent = JSON.stringify(d!.err).includes('InsufficientFundsForRent');
    results['D executorDeploy: ORE program ran Deploy to success' + (oreRan && legacyRent ? ' (tx-level rent error on legacy fixture automation, not builder)' : '')] = oreRan;
    report(`D deploy for authority ${auto.authority.toBase58().slice(0, 6)}… executor ${auto.executor.toBase58().slice(0, 6)}…`, d!);
  } else console.log('D: no funded automation fixture');

  console.log('\nSUMMARY');
  for (const [k, v] of Object.entries(results)) console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
