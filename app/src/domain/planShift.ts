// F2 / FR-2.x / AC-2.1, AC-2.2, AC-2.4 — pure shift planner (PRD v1.2).
import type { Role } from '@shift/codec';
import {
  EXECUTOR_FEE_LAMPORTS,
  MAX_BUDGET_LAMPORTS,
  MAX_FEE_SHARE_PERCENT,
  MIN_PER_SQUARE_LAMPORTS,
  ROUND_SECONDS,
} from '../config/planning';
import { ROLES } from '../config/roles';

export interface PlanParams {
  roundSeconds: number;
  feePerRound: bigint;
  minPerSquare: bigint;
  maxFeeSharePercent: bigint;
  maxBudget: bigint;
}

export const DEFAULT_PLAN_PARAMS: PlanParams = {
  roundSeconds: ROUND_SECONDS,
  feePerRound: EXECUTOR_FEE_LAMPORTS,
  minPerSquare: MIN_PER_SQUARE_LAMPORTS,
  maxFeeSharePercent: MAX_FEE_SHARE_PERCENT,
  maxBudget: MAX_BUDGET_LAMPORTS,
};

export interface PlanInput {
  role: Role;
  budgetLamports: bigint;
  lengthMinutes: number;
  nowUnix: number;
  params?: Partial<PlanParams>;
}

export type ShortenReason = 'min-per-square' | 'fee-share' | 'both';

export interface ShiftPlan {
  role: Role;
  squares: number;
  mask: bigint;
  /** NFR-S3: this is also exactly what `Automate` deposits and what the card shows as max loss. */
  budgetLamports: bigint;
  perSquareLamports: bigint;
  feePerRoundLamports: bigint;
  /** perSquare × squares + fee: what one round costs the automation. */
  spendPerRoundLamports: bigint;
  /** Rounds implied by the requested length. */
  requestedRounds: number;
  /** Rounds ORE will actually run: floor(budget ÷ spendPerRound). */
  plannedRounds: number;
  /** Set when plannedRounds was reduced below the request to satisfy MIN_PER_SQUARE / the fee rule. */
  shortenedFrom?: { rounds: number; reason: ShortenReason };
  totalFeeLamports: bigint;
  /** Fee as a share of the budget, in basis points (100 = 1 %). */
  feeShareOfBudgetBps: number;
  /** Budget not spendable in whole rounds; ORE refunds it when the automation closes. */
  leftoverLamports: bigint;
  estimatedEndUnix: number;
}

export type PlanResult =
  | { ok: true; plan: ShiftPlan }
  | { ok: false; reason: 'budget-not-positive' | 'budget-over-cap' | 'bad-length' | 'too-small' };

/**
 * targetRounds = floor(lengthMinutes × 60 ÷ roundSeconds). Rounds are reduced until BOTH hold:
 *   (a) perSquare ≥ minPerSquare, (b) feePerRound ≤ maxFeeSharePercent % of per-round spend.
 * If not even one round satisfies them the combination is rejected.
 */
export function planShift(input: PlanInput): PlanResult {
  const p: PlanParams = { ...DEFAULT_PLAN_PARAMS, ...input.params };
  const { budgetLamports: budget } = input;
  if (budget <= 0n) return { ok: false, reason: 'budget-not-positive' };
  if (budget > p.maxBudget) return { ok: false, reason: 'budget-over-cap' }; // NFR-S3
  if (!Number.isFinite(input.lengthMinutes) || input.lengthMinutes <= 0) return { ok: false, reason: 'bad-length' };

  const role = ROLES[input.role];
  const squares = BigInt(role.squares);
  const requested = Math.max(1, Math.floor((input.lengthMinutes * 60) / p.roundSeconds));

  let sawMin = false;
  let sawFee = false;
  for (let n = requested; n >= 1; n--) {
    const perRound = budget / BigInt(n);
    const perSquare = perRound > p.feePerRound ? (perRound - p.feePerRound) / squares : 0n;
    const spend = perSquare * squares + p.feePerRound;
    const okMin = perSquare >= p.minPerSquare;
    const okFee = p.feePerRound * 100n <= spend * p.maxFeeSharePercent;
    if (!okMin) sawMin = true;
    if (!okFee) sawFee = true;
    if (!(okMin && okFee)) continue;

    const planned = Number(budget / spend);
    const totalFee = BigInt(planned) * p.feePerRound;
    return {
      ok: true,
      plan: {
        role: input.role,
        squares: role.squares,
        mask: role.mask,
        budgetLamports: budget,
        perSquareLamports: perSquare,
        feePerRoundLamports: p.feePerRound,
        spendPerRoundLamports: spend,
        requestedRounds: requested,
        plannedRounds: planned,
        ...(n < requested ? { shortenedFrom: { rounds: requested, reason: reasonOf(sawMin, sawFee) } } : {}),
        totalFeeLamports: totalFee,
        feeShareOfBudgetBps: Number((totalFee * 10_000n) / budget),
        leftoverLamports: budget - BigInt(planned) * spend,
        estimatedEndUnix: input.nowUnix + planned * p.roundSeconds,
      },
    };
  }
  return { ok: false, reason: 'too-small' };
}

function reasonOf(min: boolean, fee: boolean): ShortenReason {
  return min && fee ? 'both' : min ? 'min-per-square' : 'fee-share';
}
