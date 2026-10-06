// AC-5.2: the last reconciled result is cached so a failed refresh can still show values ("Last updated {time}").
// JSON has no bigint: encode as {"$b":"123"} and revive. The cache is NEVER the source of truth (NFR-R1).
import type { ReconcileResult } from './shift';

export function encodeResult(r: ReconcileResult): string {
  return JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? { $b: v.toString() } : v));
}

export function decodeResult(json: string): ReconcileResult | null {
  try {
    const r = JSON.parse(json, (_k, v) => (v && typeof v === 'object' && typeof v.$b === 'string' && Object.keys(v).length === 1 ? BigInt(v.$b) : v)) as ReconcileResult;
    if (!r || !Array.isArray(r.history)) return null;
    return r;
  } catch {
    return null; // unreadable cache == no cache
  }
}
