// F6 — reconcile(chainSnapshot, memos, …) -> shifts + payslips. PURE: the device cache is never the source of truth (NFR-R1).
// Ledger = SHIFT1 memos in the wallet's own history (PRD §9.3). Counters = ORE Miner lifetime fields (ORE_NOTES §7.2/7.5).
import type { Automation, Miner, ShiftInMemo, ShiftOutMemo } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';
import { ROUND_SECONDS } from '../config/planning';
import { IN_SIG_PREFIX_LENGTH, type CrankStatus, type LocalHints, type Payslip, type ReconcileResult, type ShiftStatus } from './shift';

export interface ChainSnapshot {
  automation: Automation | null;
  miner: Miner | null;
}

export interface ReconcileInput {
  snapshot: ChainSnapshot;
  memos: (ShiftInMemo | ShiftOutMemo)[];
  owner: PublicKey;
  /** The SHIFT executor. Without it nothing can be recognised as a running SHIFT shift. */
  crank: PublicKey | undefined;
  crankStatus: CrankStatus;
  /** ORE actually delivered by each clock-out, keyed by the OUT signature (parsed from that transaction; immutable, cached). */
  oreReceivedByOutSignature: ReadonlyMap<string, bigint>;
  local?: LocalHints;
  roundSeconds?: number;
}

const max0 = (x: bigint) => (x < 0n ? 0n : x);

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { snapshot, owner, crank } = input;
  const roundSeconds = input.roundSeconds ?? ROUND_SECONDS;

  // ---- ledger: dedupe by signature, order oldest -> newest (blockTime, then signature for a stable tie-break)
  const seen = new Set<string>();
  const memos = input.memos.filter((m) => (seen.has(m.signature) ? false : (seen.add(m.signature), true)));
  const ins = memos
    .filter((m): m is ShiftInMemo => m.kind === 'IN')
    .sort((a, b) => a.blockTime - b.blockTime || (a.signature < b.signature ? -1 : 1));
  const outByPrefix = new Map<string, ShiftOutMemo>();
  for (const m of memos) if (m.kind === 'OUT' && !outByPrefix.has(m.inSigPrefix)) outByPrefix.set(m.inSigPrefix, m);

  const pendingSig = input.local?.pendingClockInSignature;
  const pendingClockInSignature = pendingSig && !ins.some((i) => i.signature === pendingSig) ? pendingSig : null;

  const payslips: Payslip[] = ins.map((inn, idx) => {
    const isLatest = idx === ins.length - 1;
    const next = isLatest ? null : ins[idx + 1]!;
    const out = outByPrefix.get(inn.signature.slice(0, IN_SIG_PREFIX_LENGTH)) ?? null;

    // End-of-shift counters. Latest shift: the live Miner. Older shifts: the NEXT clock-in's baselines (the counters at the moment
    // the next shift began), so shifts never double-count each other.
    const endDeployed = next ? next.baseLifeDeployed : (snapshot.miner?.lifetimeDeployed ?? inn.baseLifeDeployed);
    const endLifeSol = next ? next.baseLifeSol : (snapshot.miner?.lifetimeRewardsSol ?? inn.baseLifeSol);
    const endPendingOre = next ? next.baseOre : snapshot.miner ? snapshot.miner.rewardsOre + snapshot.miner.refinedOre : inn.baseOre;

    // A shift can never have deployed more than its own budget: caps the figure if the user later plays outside SHIFT (the Miner
    // counters keep growing after a paid shift).
    const rawDeployed = max0(endDeployed - inn.baseLifeDeployed);
    const solDeployed = rawDeployed > inn.budget ? inn.budget : rawDeployed;
    const solWon = max0(endLifeSol - inn.baseLifeSol);
    const perRoundSquares = inn.perSquare * BigInt(inn.squares);
    const spendPerRound = perRoundSquares + inn.feePerRound;
    const roundsWorked = perRoundSquares > 0n ? Number(solDeployed / perRoundSquares) : 0;
    const plannedRounds = spendPerRound > 0n ? Number(inn.budget / spendPerRound) : 0;
    const executorFees = BigInt(roundsWorked) * inn.feePerRound;
    const returnedAtClose = max0(inn.budget - solDeployed - executorFees);
    const netSol = solWon - solDeployed - executorFees - inn.setupLamports;

    // ORE (AC-6.3, E-7)
    let oreEarned: bigint | null;
    let claimedElsewhere = false;
    if (out) {
      oreEarned = input.oreReceivedByOutSignature.get(out.signature) ?? null;
    } else {
      const delta = endPendingOre - inn.baseOre;
      claimedElsewhere = delta < 0n; // the counter can only drop if something claimed it
      oreEarned = max0(delta);
    }

    // ---- state machine (PRD §9.2)
    const ours = !!(snapshot.automation && crank && snapshot.automation.executor.equals(crank) && snapshot.automation.authority.equals(owner));
    const funded = ours && snapshot.automation!.balance >= spendPerRound; // E-17: below one round ORE closes it => Complete
    let status: ShiftStatus;
    if (out) status = 'paid';
    else if (!isLatest) status = 'complete'; // superseded: never clocked out, followed by a newer clock-in
    else if (input.local?.payingInSigPrefix === inn.signature.slice(0, IN_SIG_PREFIX_LENGTH)) status = 'paying';
    else if (funded) status = input.crankStatus === 'offline' || input.crankStatus === 'stalled' ? 'paused' : 'active';
    else status = 'complete';

    const live = status === 'active' || status === 'paused' || status === 'paying';
    // An unchecked round is only a risk if the Miner deployed in it (otherwise there is nothing to forfeit).
    const unsettledRound = isLatest && !!snapshot.miner && snapshot.miner.checkpointId !== snapshot.miner.roundId;
    const rewardsAtStake = unsettledRound && snapshot.miner!.deployed.some((x) => x > 0n);
    return {
      shiftId: inn.signature,
      status,
      role: inn.role,
      localDate: inn.localDate,
      inBlockTime: inn.blockTime,
      outSignature: out?.signature ?? null,
      outBlockTime: out?.blockTime ?? null,
      budgetLamports: inn.budget,
      perSquareLamports: inn.perSquare,
      squares: inn.squares,
      feePerRoundLamports: inn.feePerRound,
      plannedRounds,
      roundsWorked,
      solDeployed,
      executorFees,
      solWon,
      oreEarned,
      oreEarlier: inn.baseOre,
      returnedAtClose,
      setupCost: inn.setupLamports,
      netSol,
      claimedElsewhere,
      unsettledRound,
      rewardsAtStake,
      superseded: !isLatest && !out,
      needsClockOut: isLatest && status === 'complete' && rewardsAtStake, // AC-6.5 (v1.6)
      canClockOut: isLatest && !out && status !== 'paying',
      balanceLeftLamports: live && snapshot.automation ? snapshot.automation.balance : null,
      estimatedSecondsLeft: status === 'active' ? Math.max(0, plannedRounds - roundsWorked) * roundSeconds : null,
    };
  });

  const history = [...payslips].reverse();
  const latest = history[0];
  return { current: latest && latest.status !== 'paid' ? latest : undefined, history, pendingClockInSignature };
}
