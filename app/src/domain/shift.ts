// F5/F6 types. PRD v1.5 §9.2 (state machine) and F6 (payslip formulas).
import type { Role } from '@shift/codec';

export type ShiftStatus = 'pending' | 'active' | 'paused' | 'complete' | 'paying' | 'paid';

/** From the crank's /health (F11). `unknown` until that is wired: treated as healthy so we never show a false "paused". */
export type CrankStatus = 'ok' | 'offline' | 'stalled' | 'unknown';

export interface Payslip {
  /** The IN transaction signature. */
  shiftId: string;
  status: ShiftStatus;
  role: Role;
  localDate: string;
  inBlockTime: number;
  outSignature: string | null;
  outBlockTime: number | null;

  budgetLamports: bigint;
  perSquareLamports: bigint;
  squares: number;
  feePerRoundLamports: bigint;
  plannedRounds: number;
  roundsWorked: number;

  /** miner.lifetimeDeployed delta. */
  solDeployed: bigint;
  /** rounds × feePerRound. */
  executorFees: bigint;
  /** miner.lifetimeRewardsSol delta — SOL ORE returned to the wallet (includes the share back from losing squares). Counted at checkpoint. */
  solWon: bigint;
  /**
   * ORE for this shift. While unpaid: (rewardsOre + refinedOre) now minus the baseline at clock-in, never negative, GROSS of ORE's
   * refining fee. When paid: what the clock-out actually delivered (NET, includes any earlier rewards, see oreEarlier); null if unknown.
   */
  oreEarned: bigint | null;
  /** Unclaimed ORE the wallet already had at clock-in (E-7): labelled "earlier rewards", never counted as this shift's. */
  oreEarlier: bigint;
  /** budget − solDeployed − executorFees: the unspent deposit ORE returns when it closes the automation. */
  returnedAtClose: bigint;
  /** Non-refundable one-off setup paid at clock-in (Miner rent + reserve), from the IN memo. */
  setupCost: bigint;
  /** solWon − solDeployed − executorFees − setupCost. Network fees are not included (the payslip says so). */
  netSol: bigint;

  /** AC-6.3: the ORE counter went DOWN, so rewards were claimed outside SHIFT. oreEarned is then 0, never negative. */
  claimedElsewhere: boolean;
  /** Latest shift only: the miner has a round not yet checkpointed, so solWon / oreEarned lag until it is. */
  unsettledRound: boolean;
  /** An older shift that was never clocked out and was followed by a newer clock-in. */
  superseded: boolean;
  /** AC-6.5: Complete and not clocked out. Home + Payslip show "Clock out within 24 h to keep your final round's rewards". */
  needsClockOut: boolean;

  /** Live automation balance (active / paused / paying only). */
  balanceLeftLamports: bigint | null;
  /** Active only. */
  estimatedSecondsLeft: number | null;
}

export interface ReconcileResult {
  /** The latest shift if it is not yet paid. */
  current?: Payslip;
  /** Every shift found in the ledger, newest first (includes `current`). */
  history: Payslip[];
  /** A clock-in we sent whose IN memo is not on chain yet (state: Pending). null once it appears or if none. */
  pendingClockInSignature: string | null;
}

/** Things only the app knows (not on chain). */
export interface LocalHints {
  /** Signature of a clock-in we submitted and have not seen confirmed. */
  pendingClockInSignature?: string;
  /** First 16 chars of the IN signature of a shift whose clock-out we submitted and have not seen confirmed. */
  payingInSigPrefix?: string;
}

export const IN_SIG_PREFIX_LENGTH = 16;
