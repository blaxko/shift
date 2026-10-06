/**
 * READ-ONLY. AC-6.1 helper: prints, for a wallet, the RAW chain values (Miner lifetime counters, Automation, SHIFT memos) and the
 * payslip(s) that reconcile() computes from them, so they can be compared with what the app shows.
 *
 *   RPC_URL=<url> npx tsx scripts/payslip-check.ts <wallet address>
 *
 * Uses the same refresh() code as the app, with an in-memory cache (so it always rebuilds from chain: this is also the AC-6.2 path).
 */
import { ORE_MINT, decode, ORE_PROGRAM_ID, pdas } from '../packages/codec/src';
import { Connection, PublicKey } from '@solana/web3.js';
import { oreReceivedFromMeta } from '../app/src/domain/oreReceived';
import { refresh, type RefreshRpc } from '../app/src/domain/refresh';
import { MemoryShiftStore } from '../app/src/domain/shiftStore';
import { describePayslip } from '../app/src/domain/payslipText';
import { formatOre, formatSolExact } from '../app/src/domain/format';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const arg = process.argv[2];
if (!arg) {
  console.error('usage: npx tsx scripts/payslip-check.ts <wallet address> [executor pubkey]');
  process.exit(2);
}
const owner = new PublicKey(arg);
const crank = new PublicKey(process.argv[3] ?? process.env.EXPO_PUBLIC_CRANK_PUBKEY ?? 'F5YFzE8dREtinnGxzTvjQVmSfS7gDgbDPfKZUYym4Ucm');
const connection = new Connection(RPC_URL, 'confirmed');

const rpc: RefreshRpc = {
  accounts: async (keys) => (await connection.getMultipleAccountsInfo(keys, 'confirmed')).map((i) => (i ? { owner: i.owner, data: i.data, lamports: i.lamports } : null)),
  signatures: async (o, opts) => (await connection.getSignaturesForAddress(o, opts, 'confirmed')).map((x) => ({ signature: x.signature, blockTime: x.blockTime ?? null, memo: x.memo ?? null, err: x.err })),
  oreReceived: async (sig, o) => oreReceivedFromMeta((await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }))?.meta ?? null, o.toBase58(), ORE_MINT.toBase58()),
};

async function main() {
  console.log(`wallet ${owner.toBase58()}   executor ${crank.toBase58()}`);
  const [w, a, m] = await connection.getMultipleAccountsInfo([owner, pdas.automation(owner), pdas.miner(owner)], 'confirmed');
  console.log(`\nRAW CHAIN`);
  console.log(`  wallet balance: ${formatSolExact(BigInt(w?.lamports ?? 0))} SOL`);
  if (a) {
    const x = decode.automation({ owner: a.owner, data: a.data });
    console.log(`  Automation: balance ${x.balance} lamports, amount ${x.amount}, fee ${x.fee}, strategy ${x.strategy}, executor ${x.executor.toBase58()}`);
  } else console.log('  Automation: none');
  if (m && m.owner.equals(ORE_PROGRAM_ID)) {
    const x = decode.miner({ owner: m.owner, data: m.data });
    console.log(`  Miner: lifetimeDeployed ${x.lifetimeDeployed}, lifetimeRewardsSol ${x.lifetimeRewardsSol}, rewardsOre ${x.rewardsOre}, refinedOre ${x.refinedOre}, roundId ${x.roundId}, checkpointId ${x.checkpointId}`);
  } else console.log('  Miner: none');

  const out = await refresh({ rpc, store: new MemoryShiftStore(), nowUnix: () => Math.floor(Date.now() / 1000) }, { owner, crank, crankStatus: 'unknown' });
  if (!out.ok) {
    console.log(`\nREFRESH FAILED: ${out.error.userMessage} (${out.error.detail})`);
    process.exit(1);
  }
  console.log(`\nRECONCILED (from scratch, ${out.rpcCalls} RPC calls) — ${out.result.history.length} shift(s)`);
  for (const p of out.result.history) {
    const t = describePayslip(p);
    console.log(`\n  shift ${p.shiftId.slice(0, 12)}…  ${p.localDate}  ${p.role}  status=${p.status}${p.superseded ? ' (superseded)' : ''}`);
    console.log(`    ${t.headline}`);
    console.log(`    rounds ${p.roundsWorked}/${p.plannedRounds}  played ${p.solDeployed}  fees ${p.executorFees}  returned-by-ORE ${p.solWon}  unspent-returned ${p.returnedAtClose}  setup ${p.setupCost}`);
    console.log(`    ORE ${p.oreEarned === null ? 'unavailable' : formatOre(p.oreEarned)}  earlier ${formatOre(p.oreEarlier)}  ${t.net.label} ${t.net.value}  claimedElsewhere=${p.claimedElsewhere}  unsettled=${p.unsettledRound}  needsClockOut=${p.needsClockOut}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
