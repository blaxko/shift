// Pure planning constants (no RN / network imports so Vitest can load them). PRD v1.2 §F2.
import { MAX_DEPOSIT_LAMPORTS } from '@shift/codec';

/** Measured wall-clock cycle over 53 consecutive mainnet rounds, 2026-10-04: 78.3 s (ORE_NOTES §7.6a). Planning estimate only. */
export const ROUND_SECONDS = 78;
/** Flat executor fee per round, lamports (decision OQ-5). */
export const EXECUTOR_FEE_LAMPORTS = 1_000n;
/** ORE has no on-chain minimum (ORE_NOTES §7.7); this is a product constant (decision OQ-5). */
export const MIN_PER_SQUARE_LAMPORTS = 1_000n;
/** Fee must be <= 5 % of per-round spend, else rounds are reduced (decision OQ-5). */
export const MAX_FEE_SHARE_PERCENT = 5n;
/** NFR-S3: single source of truth lives in the codec (enforced again in `automate`). */
export const MAX_BUDGET_LAMPORTS = MAX_DEPOSIT_LAMPORTS;

/** NFR-RD1: the picker defaults to the smallest preset. */
export const BUDGET_PRESETS_LAMPORTS = [20_000_000n, 50_000_000n, 100_000_000n] as const;
export const LENGTH_PRESETS_MINUTES = [60, 240, 480] as const;

/** FR-2.2: keep this much SOL spare for network fees on top of everything the clock-in costs. */
export const FEE_RESERVE_LAMPORTS = 10_000_000n;
/** Rough network fee for the clock-in transaction (replaced by the simulated fee in Phase 3). */
export const NETWORK_FEE_ESTIMATE_LAMPORTS = 10_000n;

// NOTE: there are deliberately NO rent constants here. Rent is a cluster parameter that changes (it changed between 2026-10-04
// and 2026-10-06, see docs/ORE_NOTES.md §7.8). The app reads it live via getMinimumBalanceForRentExemption; a unit test
// (no-hardcoded-rent.test.ts) fails if a rent literal is ever added to app/codec/crank source, and `RUN_LIVE=1` compares the
// live value with what ORE actually charges.
