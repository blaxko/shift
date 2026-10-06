// F3 — the clock-in state machine. Pure and dependency-injected so every failure path is unit-tested offline.
// FR-3.1 (conflict check), FR-3.2/AC-3.3 (simulate first), FR-3.3 (confirmation), AC-3.4 + E-3 + E-4 (unknown state ->
// reconcile before any retry), AC-3.5 (never touch a foreign automation), E-2 (declined signing -> no state change).
import { extractMemoTexts, parseMemo, stopAutomation, type Automation } from '@shift/codec';
import { TransactionMessage, VersionedTransaction, type PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { ChainResult, WalletChainState } from './chainState';
import { assertClockInInvariants, assertEndShiftInvariants, buildClockInInstructions, describeSimError } from './clockIn';
import { classifyExisting } from './conflict';
import { checkBalance, costBreakdown } from './costs';
import { appError, type AppError } from './errors';
import type { ShiftPlan } from './planShift';
import { classifyWalletError } from './walletErrors';

export type FlowStatus = 'checking' | 'simulating' | 'awaiting-wallet' | 'confirming' | 'reconciling';

export interface SimOutcome {
  err: unknown | null;
  logs: string[] | null;
  unitsConsumed?: number;
}
export interface SigStatus {
  confirmationStatus?: 'processed' | 'confirmed' | 'finalized';
  err: unknown | null;
}
export interface RecentSig {
  signature: string;
  blockTime: number | null;
  /** Raw RPC memo field ("[len] text; ..."), if any. */
  memo: string | null;
  err?: unknown | null;
}

export interface FlowDeps {
  loadState(): Promise<ChainResult>;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number; contextSlot: number }>;
  simulate(tx: VersionedTransaction): Promise<SimOutcome>;
  /** Throws if the user declines or the wallet fails. Returns the signature once the wallet has submitted. */
  signAndSend(tx: VersionedTransaction, minContextSlot: number): Promise<string>;
  signatureStatus(signature: string): Promise<SigStatus | null>;
  blockHeight(): Promise<number>;
  recentSignatures(): Promise<RecentSig[]>;
  sleep(ms: number): Promise<void>;
  nowUnix(): number;
}

export interface ClockInInput {
  owner: PublicKey;
  crank: PublicKey;
  plan: ShiftPlan;
  localDate: string;
  tzOffsetMin: number;
}

export type BlockedReason = 'no-shift' | 'chain-unavailable' | 'maintenance' | 'foreign-automation' | 'shift-active' | 'insufficient-sol';

export type ClockInOutcome =
  | { kind: 'success'; signature: string | null; via: 'confirmed' | 'reconciled' }
  | { kind: 'blocked'; reason: BlockedReason; error?: AppError; shortfallLamports?: bigint }
  | { kind: 'simulation-failed'; error: AppError }
  /** E-2: the user declined in the wallet. Nothing was sent; no state changed. */
  | { kind: 'cancelled' }
  /** Nothing landed (proven by blockhash expiry + reconcile) when `retryable`; otherwise we could not tell and the user must check Home first. */
  | { kind: 'failed'; retryable: boolean; error: AppError };

const POLL_MS = 2_000;
const MAX_POLLS = 100; // ~200 s hard stop if the RPC never reports block height progress

/** Pure: did OUR clock-in land? Used after any unknown send state (AC-3.4). Errs on the side of "yes" so we never double-submit. */
export function findOurShift(p: {
  state: WalletChainState;
  recent: RecentSig[];
  crank: PublicKey;
  plan: ShiftPlan;
  startedAtUnix: number;
}): { found: boolean; signature: string | null } {
  const a: Automation | null = p.state.automation;
  if (a && a.executor.equals(p.crank) && a.balance > 0n) {
    // The automation exists and is run by SHIFT. Find its signature if we can (nice-to-have).
    return { found: true, signature: matchMemo(p)?.signature ?? null };
  }
  const m = matchMemo(p);
  return m ? { found: true, signature: m.signature } : { found: false, signature: null };
}

function matchMemo(p: { recent: RecentSig[]; plan: ShiftPlan; startedAtUnix: number }): RecentSig | null {
  for (const s of p.recent) {
    if (s.err) continue;
    if (s.blockTime !== null && s.blockTime < p.startedAtUnix - 60) continue;
    for (const text of extractMemoTexts(s.memo)) {
      const m = parseMemo(text);
      if (m?.kind === 'IN' && m.budget === p.plan.budgetLamports && m.perSquare === p.plan.perSquareLamports && m.role === p.plan.role) return s;
    }
  }
  return null;
}

export function toTransaction(payer: PublicKey, blockhash: string, ixs: TransactionInstruction[]): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToLegacyMessage());
}

export async function runClockIn(input: ClockInInput, deps: FlowDeps, onStatus: (s: FlowStatus) => void = () => undefined): Promise<ClockInOutcome> {
  const { owner, crank, plan } = input;
  const startedAtUnix = deps.nowUnix();

  // 1. Fresh chain read + conflict check (FR-3.1). Never trust the screen's older snapshot.
  onStatus('checking');
  const loaded = await deps.loadState();
  if (!loaded.ok) {
    return { kind: 'blocked', reason: loaded.error.code === 'LAYOUT_MISMATCH' ? 'maintenance' : 'chain-unavailable', error: loaded.error };
  }
  const state = loaded.state;
  const existing = classifyExisting(state.automation, owner, crank);
  if (existing.kind === 'blocked') return { kind: 'blocked', reason: existing.why === 'shift-active' ? 'shift-active' : 'foreign-automation' }; // AC-3.5: nothing built, nothing sent

  const breakdown = costBreakdown(plan, {
    hasMiner: !!state.miner,
    minerReserveIsZero: state.miner?.checkpointFee === 0n,
    reusesIdleShell: existing.kind === 'idle-shell',
    automationRentLamports: state.automationRentLamports,
    minerRentLamports: state.minerRentLamports,
  });
  const bal = checkBalance(state.balanceLamports, breakdown);
  if (!bal.ok) return { kind: 'blocked', reason: 'insufficient-sol', shortfallLamports: bal.shortfallLamports };

  // 2. Build + guard (NFR-S2/S3/S4).
  const { instructions } = buildClockInInstructions({ owner, crank, plan, chain: state, existing, setupLamports: breakdown.setupLamports, localDate: input.localDate, tzOffsetMin: input.tzOffsetMin });
  assertClockInInvariants(instructions, { owner, crank, plan });

  return submitAndConfirm({
    deps,
    owner,
    instructions,
    onStatus,
    startedAtUnix,
    isDone: ({ state: st, recent }) => findOurShift({ state: st, recent, crank, plan, startedAtUnix }),
  });
}

export interface SubmitArgs {
  deps: FlowDeps;
  owner: PublicKey;
  instructions: TransactionInstruction[];
  onStatus: (s: FlowStatus) => void;
  startedAtUnix: number;
  /** Pure reconcile: did this exact operation land? Errs towards "yes" so we never double-submit. */
  isDone: (p: { state: WalletChainState; recent: RecentSig[] }) => { found: boolean; signature: string | null };
}

/**
 * Shared tail: simulate -> wallet -> confirm -> (if unknown) wait for blockhash expiry -> reconcile. Used by clock-in and by
 * the early "end shift" slice of F7. Guards (NFR-S2/S3/S4) run in the callers, before this.
 */
export async function submitAndConfirm(a: SubmitArgs): Promise<ClockInOutcome> {
  const { deps, owner, instructions, onStatus } = a;

  // Simulate BEFORE the wallet opens (AC-3.3).
  onStatus('simulating');
  const bh = await deps.latestBlockhash();
  const tx = toTransaction(owner, bh.blockhash, instructions);
  const sim = await deps.simulate(tx);
  if (sim.err !== null) return { kind: 'simulation-failed', error: describeSimError(sim.err, sim.logs) };

  // Sign + send through the wallet (NFR-S1).
  onStatus('awaiting-wallet');
  let signature: string | null = null;
  try {
    signature = await deps.signAndSend(tx, bh.contextSlot);
  } catch (e) {
    const c = classifyWalletError(e);
    if (c.code === 'USER_REJECTED') return { kind: 'cancelled' }; // E-2
    // E-3: the wallet failed AFTER (maybe) submitting. We cannot know. Fall through: wait for the blockhash to expire, then reconcile.
    signature = null;
  }

  // Confirm (FR-3.3) or, if unknown, wait for expiry (E-4).
  onStatus('confirming');
  const waited = await waitForOutcome(deps, signature, bh.lastValidBlockHeight);
  if (waited.kind === 'confirmed') return { kind: 'success', signature, via: 'confirmed' };
  if (waited.kind === 'tx-error') return { kind: 'failed', retryable: true, error: appError('TX_FAILED', 'The transaction failed on the network. Nothing was taken except the network fee. Please try again.', JSON.stringify(waited.err)) };

  // Unknown or expired: reconcile from chain BEFORE offering any retry (AC-3.4).
  onStatus('reconciling');
  const [after, recent] = await Promise.all([deps.loadState(), deps.recentSignatures().catch(() => [] as RecentSig[])]);
  if (!after.ok) {
    return { kind: 'failed', retryable: false, error: appError('RPC_UNAVAILABLE', "We couldn't check whether it went through. Open Home to see before trying again.", after.error.detail) };
  }
  const found = a.isDone({ state: after.state, recent });
  if (found.found) return { kind: 'success', signature: found.signature ?? signature, via: 'reconciled' };
  if (waited.kind === 'gave-up') {
    return { kind: 'failed', retryable: false, error: appError('EXPIRED', "We couldn't confirm it. Check Home before trying again.", 'poll limit reached before blockhash expiry') };
  }
  return { kind: 'failed', retryable: true, error: appError('EXPIRED', "The transaction didn't go through in time. Nothing was taken from your wallet. Please try again.", `blockhash expired at height ${bh.lastValidBlockHeight}`) }; // E-4
}

/**
 * Early slice of F7 ("End shift early"): stop the automation, which makes ORE close it and return balance + rent to the wallet
 * (automate.rs:87-97). Only ever acts on a SHIFT automation (executor == crank, AC-3.5 spirit). Claims + OUT memo come in Phase 6.
 */
export async function runEndShift(
  input: { owner: PublicKey; crank: PublicKey },
  deps: FlowDeps,
  onStatus: (s: FlowStatus) => void = () => undefined,
): Promise<ClockInOutcome | { kind: 'blocked'; reason: 'no-shift' }> {
  onStatus('checking');
  const loaded = await deps.loadState();
  if (!loaded.ok) return { kind: 'blocked', reason: loaded.error.code === 'LAYOUT_MISMATCH' ? 'maintenance' : 'chain-unavailable', error: loaded.error };
  const a = loaded.state.automation;
  if (!a) return { kind: 'blocked', reason: 'no-shift' };
  if (!a.executor.equals(input.crank)) return { kind: 'blocked', reason: 'foreign-automation' }; // never touch what isn't ours
  const ix = stopAutomation(input.owner);
  assertEndShiftInvariants([ix], input.owner);
  const startedAtUnix = deps.nowUnix();
  return submitAndConfirm({
    deps,
    owner: input.owner,
    instructions: [ix],
    onStatus,
    startedAtUnix,
    isDone: ({ state: st }) => ({ found: st.automation === null, signature: null }),
  });
}

type Waited = { kind: 'confirmed' } | { kind: 'tx-error'; err: unknown } | { kind: 'expired' } | { kind: 'gave-up' };

async function waitForOutcome(deps: FlowDeps, signature: string | null, lastValidBlockHeight: number): Promise<Waited> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signature) {
      const st = await deps.signatureStatus(signature).catch(() => null);
      if (st?.err) return { kind: 'tx-error', err: st.err };
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { kind: 'confirmed' };
    }
    const h = await deps.blockHeight().catch(() => null);
    if (h !== null && h > lastValidBlockHeight) {
      // The blockhash is dead: the transaction can never land from here. One last status look, then it is final.
      if (signature) {
        const st = await deps.signatureStatus(signature).catch(() => null);
        if (st?.err) return { kind: 'tx-error', err: st.err };
        if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { kind: 'confirmed' };
      }
      return { kind: 'expired' };
    }
    await deps.sleep(POLL_MS);
  }
  return { kind: 'gave-up' };
}
