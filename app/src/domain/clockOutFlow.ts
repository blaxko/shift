// F7 — clock-out / end-shift state machine (same shape and safety as the clock-in flow). AC-7.1-7.4, AC-3.4-style reconcile.
//   1. fresh chain read; refuse if this shift already has an OUT memo (never pay twice)
//   2. if a Checkpoint is needed: simulate it ALONE and read the Miner's post-state, so claims are decided on what will really be there
//   3. build -> pre-sign guard -> simulate -> wallet -> confirm; unknown state waits for blockhash expiry, then looks for the OUT memo
import { decode, extractMemoTexts, parseMemo, pdas, checkpoint, LayoutMismatch, type Miner } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';
import { assertClockOutInvariants, buildClockOutInstructions, planClockOut, type ClockOutPlan } from './clockOut';
import { describeSimError } from './clockIn';
import { submitAndConfirm, toTransaction, type ClockInOutcome, type FlowDeps, type FlowStatus, type RecentSig } from './clockInFlow';
import { appError } from './errors';
import { IN_SIG_PREFIX_LENGTH } from './shift';

export interface ClockOutInput {
  owner: PublicKey;
  crank: PublicKey;
  /** The IN transaction signature of the shift being closed out. */
  inSignature: string;
}

export type ClockOutOutcome = ClockInOutcome;

/** Pure: has an OUT memo for this shift landed? (also used to refuse a second clock-out) */
export function findOutMemo(recent: RecentSig[], inSignature: string): RecentSig | null {
  const prefix = inSignature.slice(0, IN_SIG_PREFIX_LENGTH);
  for (const s of recent) {
    if (s.err) continue;
    for (const text of extractMemoTexts(s.memo)) {
      const m = parseMemo(text);
      if (m?.kind === 'OUT' && m.inSigPrefix === prefix) return s;
    }
  }
  return null;
}

export async function runClockOut(input: ClockOutInput, deps: FlowDeps, onStatus: (s: FlowStatus) => void = () => undefined): Promise<ClockOutOutcome & { plan?: ClockOutPlan }> {
  const { owner, crank, inSignature } = input;
  const startedAtUnix = deps.nowUnix();

  onStatus('checking');
  const [loaded, recent] = await Promise.all([deps.loadState(), deps.recentSignatures().catch(() => [] as RecentSig[])]);
  if (!loaded.ok) return { kind: 'blocked', reason: loaded.error.code === 'LAYOUT_MISMATCH' ? 'maintenance' : 'chain-unavailable', error: loaded.error };
  if (findOutMemo(recent, inSignature)) return { kind: 'blocked', reason: 'already-paid' };
  const state = loaded.state;

  // ---- what will the checkpoint credit? (only if one is needed)
  let settled: Miner | null = state.miner;
  const needsCheckpoint = !!state.miner && state.miner.checkpointId !== state.miner.roundId;
  if (needsCheckpoint) {
    onStatus('simulating');
    const bh = await deps.latestBlockhash();
    const probe = toTransaction(owner, bh.blockhash, [checkpoint({ signer: owner, authority: owner, roundId: state.miner!.roundId })]);
    const sim = await deps.simulateAccounts(probe, [pdas.miner(owner)]);
    if (sim.err !== null) return { kind: 'simulation-failed', error: describeSimError(sim.err, sim.logs) };
    const acct = sim.accounts[0];
    if (acct) {
      try {
        settled = decode.miner(acct);
      } catch (e) {
        if (e instanceof LayoutMismatch) return { kind: 'blocked', reason: 'maintenance', error: appError('LAYOUT_MISMATCH', 'ORE was updated. SHIFT is in read-only maintenance mode until it is updated too.', e) };
        throw e;
      }
    }
  }

  const plan = planClockOut({ miner: state.miner, settled, automation: state.automation, owner, crank });
  const { instructions } = buildClockOutInstructions({ owner, plan, inSignature });
  assertClockOutInvariants(instructions, { owner, inSignature });

  const out = await submitAndConfirm({
    deps,
    owner,
    instructions,
    onStatus,
    startedAtUnix,
    isDone: ({ recent: r }) => {
      const hit = findOutMemo(r, inSignature);
      return { found: !!hit, signature: hit?.signature ?? null };
    },
  });
  return { ...out, plan };
}
