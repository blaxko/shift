/**
 * READ-ONLY integration check of the crank's real planner + batcher + DryRunSubmitter against live mainnet automations.
 * Nothing is signed or sent (simulateTransaction, sigVerify:false). No keys.
 *
 * Why this works: automations whose executor is ORE's permissionless address (consts.rs:80) accept ANY signer
 * (deploy.rs:76). So we plan against that executor and simulate with a funded public address as the stand-in signer.
 * This is NOT AC-4.4 (that needs a SHIFT-created automation, after the device clock-in test); it validates the machinery.
 *
 *   RPC_URL=<url> npx tsx scripts/crank-dryrun-permissionless.ts
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { PERMISSIONLESS_EXECUTOR } from '../packages/codec/src';
import { packBatches } from '../crank/src/batch';
import { rpcChain } from '../crank/src/chain';
import { consoleLogger } from '../crank/src/log';
import { planRound, windowOpen } from '../crank/src/plan';
import { DryRunSubmitter, type RpcLike } from '../crank/src/submit';

const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
// A funded system account used ONLY as the simulated fee payer / signer (public address; we hold no key for it).
const STAND_IN_SIGNER = new PublicKey('DyB4Kv6V613gp2LWQTq1dwDYHGKuUEoDHnCouGUtxFiX');
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? 12);

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const chain = rpcChain(connection, consoleLogger());
  const submitter = new DryRunSubmitter(connection as unknown as RpcLike, STAND_IN_SIGNER);

  for (let attempt = 0; attempt < 25; attempt++) {
    const [slot, board] = await Promise.all([chain.slot(), chain.board()]);
    if (!windowOpen(board, slot, 8n)) {
      console.log(`round ${board.roundId}: window closed (slot ${slot}, end ${board.endSlot}); waiting…`);
      await new Promise((r) => setTimeout(r, 4_000));
      continue;
    }
    const autos = await chain.automationsFor(PERMISSIONLESS_EXECUTOR);
    const miners = await chain.miners(autos.map((a) => a.authority));
    const plan = planRound({ board, automations: autos, miners, executor: PERMISSIONLESS_EXECUTOR });
    const skipped = plan.skipped.reduce<Record<string, number>>((m, s) => ((m[s.reason] = (m[s.reason] ?? 0) + 1), m), {});
    console.log(`round ${board.roundId}: ${autos.length} permissionless automations; active(Preferred+funded)=${plan.activeCount}; to-deploy=${plan.items.length}; skipped=${JSON.stringify(skipped)}`);
    console.log(`  of the to-deploy items, ${plan.items.filter((i) => i.checkpointRoundId !== null).length} need a Checkpoint first`);

    let items = plan.items.slice(0, MAX_ITEMS);
    if (items.length === 0 && process.env.FORCE === '1') {
      // Everything is already deployed this round (ORE's bots are fast). Force the ACTIVE ones through the batcher + simulator
      // to exercise the real account list / tx size / compute units. A deploy for an already-deployed miner is a no-op.
      items = autos.filter((a) => a.strategy === 1n && a.balance > 0n).slice(0, MAX_ITEMS).map((a) => ({ authority: a.authority, automation: a, checkpointRoundId: null }));
      console.log(`  FORCE=1: simulating ${items.length} already-deployed automations (account-list / size / CU check only)`);
    }
    const batches = packBatches({ executor: STAND_IN_SIGNER, roundId: board.roundId, items, priorityFeeMicroLamports: 1000, maxItemsPerTx: 5 });
    console.log(`  simulating ${items.length} items in ${batches.length} batch(es)`);
    let ok = 0;
    for (const [i, b] of batches.entries()) {
      const r = await submitter.submit(b, { roundId: board.roundId });
      if (r.kind === 'simulated-ok') {
        ok += b.items.length;
        console.log(`   batch ${i + 1}: OK  items=${b.items.length} ixs=${b.instructions.length} CU=${r.unitsConsumed}`);
      } else if (r.kind === 'simulated-fail') {
        console.log(`   batch ${i + 1}: FAIL items=${b.items.length} err=${JSON.stringify(r.err)}`);
        for (const l of r.logs.slice(-3)) console.log(`        ${l}`);
      }
    }
    console.log(`SUMMARY: ${ok}/${items.length} automations simulated OK (nothing was sent)`);
    return;
  }
  console.log('no open round window observed in time');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
