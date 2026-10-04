import type { ParsedMemo, ShiftInFields, ShiftOutFields } from './types';

// PRD v1.1 §9.3. Strict: anything that is not byte-for-byte canonical returns null (E-20).
//   SHIFT1|IN|<role>|<budget>|<perSquare>|<squares>|<feePerRound>|<setupLamports>|<baseLifeSol>|<baseLifeDeployed>|<baseOre>|<YYYY-MM-DD>|<tzOffsetMin>
//   SHIFT1|OUT|<inSigPrefix16>

export const MEMO_MAX_BYTES = 200;
const U64_MAX = 0xffffffffffffffffn;
const ROLES = ['safe', 'balanced', 'sniper'] as const;
const UINT = /^(0|[1-9][0-9]{0,19})$/; // canonical decimal: no leading zeros, no sign, no spaces
const TZ = /^(0|-?[1-9][0-9]{0,3})$/; // canonical signed integer, no "-0"
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SIG_PREFIX = /^[1-9A-HJ-NP-Za-km-z]{16}$/; // base58 alphabet
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function u64(s: string | undefined): bigint | null {
  if (s === undefined || !UINT.test(s)) return null;
  const n = BigInt(s);
  return n <= U64_MAX ? n : null;
}

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Parse a memo string. Never throws. Unknown versions, malformed or non-canonical input => null. */
export function parseMemo(text: string): ParsedMemo | null {
  if (typeof text !== 'string' || text.length > MEMO_MAX_BYTES || !PRINTABLE_ASCII.test(text)) return null;
  const f = text.split('|');
  if (f[0] !== 'SHIFT1') return null;

  if (f[1] === 'OUT') {
    if (f.length !== 3 || !SIG_PREFIX.test(f[2]!)) return null;
    return { kind: 'OUT', inSigPrefix: f[2]! };
  }

  if (f[1] === 'IN') {
    if (f.length !== 13) return null;
    const role = f[2] as (typeof ROLES)[number];
    if (!ROLES.includes(role)) return null;
    const budget = u64(f[3]);
    const perSquare = u64(f[4]);
    const squaresBig = u64(f[5]);
    const feePerRound = u64(f[6]);
    const setupLamports = u64(f[7]);
    const baseLifeSol = u64(f[8]);
    const baseLifeDeployed = u64(f[9]);
    const baseOre = u64(f[10]);
    const localDate = f[11]!;
    if ([budget, perSquare, squaresBig, feePerRound, setupLamports, baseLifeSol, baseLifeDeployed, baseOre].some((x) => x === null)) return null;
    const squares = Number(squaresBig);
    if (squares < 1 || squares > 25) return null;
    if (!validDate(localDate)) return null;
    if (!TZ.test(f[12]!)) return null;
    const tzOffsetMin = Number(f[12]);
    if (tzOffsetMin < -840 || tzOffsetMin > 840) return null;
    return {
      kind: 'IN',
      role,
      budget: budget!,
      perSquare: perSquare!,
      squares,
      feePerRound: feePerRound!,
      setupLamports: setupLamports!,
      baseLifeSol: baseLifeSol!,
      baseLifeDeployed: baseLifeDeployed!,
      baseOre: baseOre!,
      localDate,
      tzOffsetMin,
    };
  }
  return null;
}

const joinIn = (m: ShiftInFields) =>
  ['SHIFT1', 'IN', m.role, m.budget, m.perSquare, m.squares, m.feePerRound, m.setupLamports, m.baseLifeSol, m.baseLifeDeployed, m.baseOre, m.localDate, m.tzOffsetMin].join('|');

/** Format an IN memo. Throws if the result would not parse back identically (we never write what we can't read). */
export function formatInMemo(m: ShiftInFields): string {
  const text = joinIn(m);
  const back = parseMemo(text);
  if (!back || back.kind !== 'IN' || joinIn(back) !== text) throw new Error(`invalid SHIFT IN memo: ${text}`);
  return text;
}

export function formatOutMemo(m: ShiftOutFields): string {
  const text = `SHIFT1|OUT|${m.inSigPrefix}`;
  if (parseMemo(text)?.kind !== 'OUT') throw new Error(`invalid SHIFT OUT memo: ${text}`);
  return text;
}

/**
 * RPC `getSignaturesForAddress` returns the memo as "[<byteLength>] <text>" (possibly several, joined by "; ").
 * Returns the SHIFT1 memo text(s) in it; callers feed each into parseMemo.
 */
export function extractMemoTexts(rpcMemoField: string | null | undefined): string[] {
  if (!rpcMemoField) return [];
  return rpcMemoField
    .split('; ')
    .map((part) => part.replace(/^\[\d+\] /, ''))
    .filter((t) => t.startsWith('SHIFT1|'));
}
