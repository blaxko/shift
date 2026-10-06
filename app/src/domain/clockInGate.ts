// Why the Clock in button is disabled (shown under it). '' means enabled. Pure, so every rule is unit-tested. E-5, E-6, E-11, E-23, AC-2.3.

export interface GateInput {
  /** E-23: ORE's program IDs are mainnet-only; on any other cluster the ORE features are unavailable. */
  mainnet: boolean;
  /** The SHIFT executor's public key is configured in this build. */
  crankConfigured: boolean;
  /** E-11: ORE layout changed under us -> read-only maintenance mode. */
  maintenance: boolean;
  /** planShift produced a valid plan for the chosen role/budget/length. */
  planOk: boolean;
  /** The wallet's chain state has been read. */
  chainLoaded: boolean;
  /** E-6: an existing automation we must not touch. */
  blockedByExisting: boolean;
  /** E-5 / AC-2.3: the balance is short. */
  insufficientBalance: boolean;
}

export function clockInBlockReason(g: GateInput): string {
  if (!g.mainnet) return 'ORE only runs on mainnet. This build points at devnet, so shifts are disabled.';
  if (!g.crankConfigured) return 'The SHIFT executor is not configured in this build';
  if (g.maintenance) return 'ORE maintenance mode';
  if (!g.planOk) return 'Choose a valid shift';
  if (!g.chainLoaded) return 'Checking your wallet…';
  if (g.blockedByExisting) return 'You already have an ORE automation';
  if (g.insufficientBalance) return 'Not enough SOL';
  return '';
}

/** E-6: where to send a user whose existing ORE automation blocks SHIFT ("link to ORE's app to stop it"). Verified to resolve. */
export const ORE_APP_URL = 'https://ore.com';
