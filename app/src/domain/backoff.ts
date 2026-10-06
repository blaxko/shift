// E-12: "exponential backoff (1/2/4/8 s, max 30 s)" after an RPC failure. Pure.

const STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
export const BACKOFF_MAX_MS = 30_000;

/** Delay before the next retry after `failures` consecutive failures (1 = the first failure). 1, 2, 4, 8, 16 s, then 30 s. */
export function retryDelayMs(failures: number): number {
  if (!Number.isFinite(failures) || failures < 1) return STEPS_MS[0]!;
  return failures > STEPS_MS.length ? BACKOFF_MAX_MS : STEPS_MS[failures - 1]!;
}
