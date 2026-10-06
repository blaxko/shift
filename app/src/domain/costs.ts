// FR-2.1 cost breakdown, FR-2.2 balance check, AC-2.3, AC-2.5. Pure. ORE_NOTES §7.8, §7.12.
import { CHECKPOINT_FEE_LAMPORTS } from '@shift/codec';
import { FEE_RESERVE_LAMPORTS, NETWORK_FEE_ESTIMATE_LAMPORTS } from '../config/planning';
import type { ShiftPlan } from './planShift';

/** What the chain says about the wallet's ORE accounts, plus current rent minimums. */
export interface ChainCostContext {
  /** Does the wallet already have an ORE Miner account? (Rent for it is paid once, ever.) */
  hasMiner: boolean;
  /** miner.checkpoint_fee == 0 (only meaningful when hasMiner). A fresh Miner always needs the reserve. */
  minerReserveIsZero: boolean;
  /** An idle shell automation will be closed and replaced in the same tx (FR-3.1): its rent is swapped, not added. */
  reusesIdleShell: boolean;
  automationRentLamports: bigint;
  minerRentLamports: bigint;
  networkFeeLamports?: bigint;
}

export type CostKind = 'budget' | 'automation-rent' | 'miner-rent' | 'checkpoint-reserve' | 'executor-fees' | 'network-fee';

export interface CostLine {
  kind: CostKind;
  lamports: bigint;
  /** AC-2.5: every line says whether it can come back. */
  refundable: boolean;
  /** true => leaves the wallet now (counted in `totalLeavingWalletNow`). Executor fees are paid out of the budget, so false. */
  leavesWallet: boolean;
  note?: string;
}

export interface CostBreakdown {
  lines: CostLine[];
  /** Everything the clock-in transaction takes from the wallet. */
  totalLeavingWalletNow: bigint;
  /** Non-refundable one-off setup (Miner rent + checkpoint reserve): goes into the IN memo's `setupLamports` and the payslip. */
  setupLamports: bigint;
}

export function costBreakdown(plan: ShiftPlan, ctx: ChainCostContext): CostBreakdown {
  const lines: CostLine[] = [
    {
      kind: 'budget',
      lamports: plan.budgetLamports,
      refundable: true,
      leavesWallet: true,
      note: 'Max you can lose; unspent budget is returned when the shift ends',
    },
    {
      kind: 'automation-rent',
      // Closing the old idle shell refunds its rent in the same transaction, so net new cost is 0.
      lamports: ctx.reusesIdleShell ? 0n : ctx.automationRentLamports,
      refundable: true,
      leavesWallet: true,
      note: ctx.reusesIdleShell ? 'Swapped with your idle ORE automation' : 'Returned when ORE closes the automation',
    },
  ];

  let setup = 0n;
  if (!ctx.hasMiner) {
    lines.push({
      kind: 'miner-rent',
      lamports: ctx.minerRentLamports,
      refundable: false,
      leavesWallet: true,
      note: 'One-time, first shift only; reused by every later shift',
    });
    setup += ctx.minerRentLamports;
  }
  if (!ctx.hasMiner || ctx.minerReserveIsZero) {
    lines.push({
      kind: 'checkpoint-reserve',
      lamports: CHECKPOINT_FEE_LAMPORTS,
      refundable: false,
      leavesWallet: true,
      note: 'ORE checkpoint reserve held in your Miner account',
    });
    setup += CHECKPOINT_FEE_LAMPORTS;
  }

  lines.push({
    kind: 'executor-fees',
    lamports: plan.totalFeeLamports,
    refundable: false,
    leavesWallet: false, // comes out of the budget
    note: 'Paid out of the budget, per round',
  });
  lines.push({
    kind: 'network-fee',
    lamports: ctx.networkFeeLamports ?? NETWORK_FEE_ESTIMATE_LAMPORTS,
    refundable: false,
    leavesWallet: true,
    note: 'Solana transaction fee (estimate)',
  });

  const totalLeavingWalletNow = lines.filter((l) => l.leavesWallet).reduce((a, l) => a + l.lamports, 0n);
  return { lines, totalLeavingWalletNow, setupLamports: setup };
}

export type BalanceCheck = { ok: true; neededLamports: bigint } | { ok: false; neededLamports: bigint; shortfallLamports: bigint };

/** FR-2.2 / AC-2.3: balance must cover everything leaving the wallet plus a 0.01 SOL fee reserve. */
export function checkBalance(balanceLamports: bigint, breakdown: CostBreakdown, feeReserve = FEE_RESERVE_LAMPORTS): BalanceCheck {
  const needed = breakdown.totalLeavingWalletNow + feeReserve;
  return balanceLamports >= needed ? { ok: true, neededLamports: needed } : { ok: false, neededLamports: needed, shortfallLamports: needed - balanceLamports };
}

const COST_LABEL: Record<CostKind, string> = {
  budget: 'Shift budget',
  'automation-rent': 'ORE automation account rent',
  'miner-rent': 'ORE miner account rent',
  'checkpoint-reserve': 'ORE checkpoint reserve',
  'executor-fees': 'Executor fees (from the budget)',
  'network-fee': 'Network fee (estimate)',
};

/** AC-2.5: every cost line says whether it can come back. The budget is the max-loss figure, so it reads "at risk (unspent part returned)". */
export const costLabel = (kind: CostKind, refundable: boolean): string =>
  kind === 'budget' ? `${COST_LABEL.budget} — at risk (unspent part returned)` : `${COST_LABEL[kind]} — ${refundable ? 'Refundable' : 'Not refundable'}`;

/** TalkBack wording for the same distinction (NFR-A2). */
export const costSpoken = (kind: CostKind, refundable: boolean): string =>
  kind === 'budget' ? 'at risk, unspent part returned' : refundable ? 'refundable' : 'not refundable';
