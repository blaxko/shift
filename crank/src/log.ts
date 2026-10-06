// FR-4 step 6: structured JSON-lines logging. NFR-S5: nothing secret is ever passed in; values that look like long
// base58/hex strings under suspicious keys are redacted as a second line of defence.
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const SUSPICIOUS = /secret|private|keypair|seed|mnemonic|password|apikey|api_key|token/i;

export function redact(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = SUSPICIOUS.test(k) ? '[redacted]' : typeof v === 'bigint' ? v.toString() : v;
  }
  return out;
}

export function consoleLogger(write: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: string) => (event: string, data?: Record<string, unknown>) =>
    write(JSON.stringify({ t: new Date().toISOString(), level, event, ...redact(data) }));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
