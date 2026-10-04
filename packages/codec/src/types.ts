// Domain types shared by app, codec and crank. PRD v1.1 §9.2.

export type Role = 'safe' | 'balanced' | 'sniper';

/** Fields of the on-chain IN memo (PRD §9.3). Everything is a decimal string on chain. */
export interface ShiftInFields {
  role: Role;
  budget: bigint;
  perSquare: bigint;
  squares: number;
  /** Executor fee per round, lamports. Recorded because the Automation account (the only other place it lives) is closed by ORE when depleted. */
  feePerRound: bigint;
  /** miner.lifetime_rewards_sol at clock-in. */
  baseLifeSol: bigint;
  /** miner.lifetime_deployed at clock-in. */
  baseLifeDeployed: bigint;
  /** miner.rewards_ore + miner.refined_ore at clock-in. */
  baseOre: bigint;
  /** Local calendar date YYYY-MM-DD. */
  localDate: string;
  /** Minutes east of UTC (so UTC+1 = 60). */
  tzOffsetMin: number;
}

export interface ShiftOutFields {
  /** First 16 chars of the IN transaction signature. */
  inSigPrefix: string;
}

export type ParsedMemo = ({ kind: 'IN' } & ShiftInFields) | ({ kind: 'OUT' } & ShiftOutFields);

/** A parsed memo plus where it was found on chain. */
export type ShiftInMemo = { v: 1; kind: 'IN'; signature: string; blockTime: number } & ShiftInFields;
export type ShiftOutMemo = { v: 1; kind: 'OUT'; signature: string; blockTime: number } & ShiftOutFields;
