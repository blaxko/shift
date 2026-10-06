/**
 * READ-ONLY. AC-4.1 measurement: "WHEN a SHIFT automation has balance >= the per-round cost THE CRANK SHALL deploy it in >= 98 % of
 * rounds over a 30-minute test."
 *
 * Exact, from chain counters (no logs, no guesswork):
 *   rounds that happened  = Board.round_id now - Board.round_id at the start
 *   rounds deployed       = (Miner.lifetime_deployed now - at start) / (automation.amount x squares)
 *   rounds that COULD be deployed are capped by what the budget affords (floor(balance / round cost)).
 *
 *   npx tsx scripts/liveness.ts snapshot <wallet> [file]    # at the start of the test -> writes JSON
 *   npx tsx scripts/liveness.ts report   <wallet> [file]    # at the end -> prints the rate and PASS/FAIL
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { BOARD_ADDRESS, ORE_PROGRAM_ID, decode, pdas } from '../packages/codec/src';

export interface Snapshot {
  at: string;
  boardRound: string;
  lifetimeDeployed: string;
  automationBalance: string;
  /** automation.amount x squares: lamports deployed per round. */
  deployedPerRound: string;
  /** deployedPerRound + fee: what a round costs the automation. */
  costPerRound: string;
}

export interface LivenessReport {
  roundsElapsed: number;
  roundsAffordable: number;
  /** min(elapsed, affordable): the rounds in which a deploy was REQUIRED. */
  roundsExpected: number;
  roundsDeployed: number;
  missed: number;
  rate: number;
  /** Largest number of misses that still meets the threshold. */
  maxMissAllowed: number;
  pass: boolean;
  /** Deployed lamports were not a whole number of rounds: something else deployed on this miner during the window. */
  notes: string[];
}

export const THRESHOLD = 0.98;

export function livenessReport(start: Snapshot, end: Snapshot): LivenessReport {
  const per = BigInt(start.deployedPerRound);
  const cost = BigInt(start.costPerRound);
  const notes: string[] = [];
  const roundsElapsed = Number(BigInt(end.boardRound) - BigInt(start.boardRound));
  const roundsAffordable = cost > 0n ? Number(BigInt(start.automationBalance) / cost) : 0;
  const deployedLamports = BigInt(end.lifetimeDeployed) - BigInt(start.lifetimeDeployed);
  const roundsDeployed = per > 0n ? Number(deployedLamports / per) : 0;
  if (per > 0n && deployedLamports % per !== 0n) notes.push('deployed lamports are not a whole number of rounds: this miner deployed something else during the window');
  const roundsExpected = Math.max(0, Math.min(roundsElapsed, roundsAffordable));
  const missed = Math.max(0, roundsExpected - roundsDeployed);
  const rate = roundsExpected > 0 ? Math.min(1, roundsDeployed / roundsExpected) : 0;
  const maxMissAllowed = Math.floor(roundsExpected * (1 - THRESHOLD));
  if (roundsExpected === 0) notes.push('no rounds were expected in this window: nothing to measure');
  return { roundsElapsed, roundsAffordable, roundsExpected, roundsDeployed, missed, rate, maxMissAllowed, pass: roundsExpected > 0 && rate >= THRESHOLD, notes };
}

const popcount = (m: bigint) => m.toString(2).replace(/0/g, '').length;

async function takeSnapshot(connection: Connection, wallet: PublicKey): Promise<Snapshot> {
  const [board, auto, miner] = await connection.getMultipleAccountsInfo([BOARD_ADDRESS, pdas.automation(wallet), pdas.miner(wallet)], 'confirmed');
  if (!board || !auto || !miner) throw new Error('need a running shift: Board, Automation and Miner must all exist');
  const a = decode.automation({ owner: ORE_PROGRAM_ID, data: auto.data });
  const m = decode.miner({ owner: ORE_PROGRAM_ID, data: miner.data });
  const b = decode.board({ owner: ORE_PROGRAM_ID, data: board.data });
  const per = a.amount * BigInt(popcount(a.mask));
  return { at: new Date().toISOString(), boardRound: b.roundId.toString(), lifetimeDeployed: m.lifetimeDeployed.toString(), automationBalance: a.balance.toString(), deployedPerRound: per.toString(), costPerRound: (per + a.fee).toString() };
}

async function main() {
  const [mode, walletArg, file = 'liveness-start.json'] = process.argv.slice(2);
  if ((mode !== 'snapshot' && mode !== 'report') || !walletArg) {
    console.error('usage: npx tsx scripts/liveness.ts <snapshot|report> <wallet> [file]');
    process.exit(2);
  }
  const wallet = new PublicKey(walletArg);
  const connection = new Connection(process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
  if (mode === 'snapshot') {
    const snap = await takeSnapshot(connection, wallet);
    writeFileSync(file, JSON.stringify(snap, null, 2));
    console.log(`saved ${file}: round ${snap.boardRound}, deployed so far ${snap.lifetimeDeployed} lamports, budget left ${snap.automationBalance}`);
    return;
  }
  const start = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  // The automation may have closed (budget used up): then the end figures come from what is left on chain.
  let end: Snapshot;
  try {
    end = await takeSnapshot(connection, wallet);
  } catch {
    const [board, miner] = await connection.getMultipleAccountsInfo([BOARD_ADDRESS, pdas.miner(wallet)], 'confirmed');
    if (!board || !miner) throw new Error('Board or Miner missing');
    end = { ...start, at: new Date().toISOString(), boardRound: decode.board({ owner: ORE_PROGRAM_ID, data: board.data }).roundId.toString(), lifetimeDeployed: decode.miner({ owner: ORE_PROGRAM_ID, data: miner.data }).lifetimeDeployed.toString(), automationBalance: '0' };
  }
  const r = livenessReport(start, end);
  console.log(`window: ${start.at}  ->  ${end.at}`);
  console.log(`rounds that happened ${r.roundsElapsed}, affordable by the budget ${r.roundsAffordable}, deploys REQUIRED ${r.roundsExpected}`);
  console.log(`rounds deployed ${r.roundsDeployed}, missed ${r.missed}  (allowed to miss at most ${r.maxMissAllowed} for >= 98 %)`);
  console.log(`RATE ${(r.rate * 100).toFixed(1)} %  ->  ${r.pass ? 'PASS' : 'FAIL'}`);
  for (const n of r.notes) console.log(`note: ${n}`);
  process.exit(r.pass ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
