// AC-1.3, AC-1.4, E-1, E-2 — map wallet-adapter failures to typed AppErrors. Pure, duck-typed (no RN imports).
import { appError, type AppError } from './errors';

// @solana-mobile/mobile-wallet-adapter-protocol: transport errors carry a string `code`, protocol errors a negative number.
const CANCELLED_STRING_CODES = new Set(['ERROR_ASSOCIATION_CANCELLED']);
const REJECTED_NUMERIC_CODES = new Set([-1 /* AUTHORIZATION_FAILED: user declined */, -3 /* NOT_SIGNED: user declined to sign */]);

export function classifyWalletError(e: unknown): AppError {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);

  if (code === 'ERROR_WALLET_NOT_FOUND' || /no installed wallet/i.test(message)) {
    return appError('NO_WALLET', 'No compatible wallet found', e);
  }
  if ((typeof code === 'string' && CANCELLED_STRING_CODES.has(code)) || (typeof code === 'number' && REJECTED_NUMERIC_CODES.has(code))) {
    return appError('USER_REJECTED', 'Cancelled — nothing was sent', e);
  }
  return appError('UNKNOWN', 'Could not connect to your wallet. Please try again.', e);
}
