// PRD §10: errors are typed; raw RPC/wallet errors are never shown to the user, `detail` only under "Details".

export type AppErrorCode =
  | 'NO_WALLET' // E-1 / AC-1.3
  | 'USER_REJECTED' // E-2 / AC-1.4
  | 'RPC_UNAVAILABLE' // E-12
  | 'LAYOUT_MISMATCH' // E-11
  | 'UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  userMessage: string;
  detail: string;
}

export const appError = (code: AppErrorCode, userMessage: string, detail: unknown): AppError => ({
  code,
  userMessage,
  detail: detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail),
});
