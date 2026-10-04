import { describe, expect, it } from 'vitest';
import { extractMemoTexts, formatInMemo, formatOutMemo, parseMemo, type ShiftInFields } from '../src';

const IN: ShiftInFields = {
  role: 'balanced',
  budget: 50_000_000n,
  perSquare: 12_000n,
  squares: 10,
  feePerRound: 1000n,
  baseLifeSol: 291_129_732n,
  baseLifeDeployed: 1_234_567_890n,
  baseOre: 2_054_599_192n,
  localDate: '2026-10-04',
  tzOffsetMin: 60,
};
const GOOD = 'SHIFT1|IN|balanced|50000000|12000|10|1000|291129732|1234567890|2054599192|2026-10-04|60';

describe('memo format / parse (PRD §9.3 v1.1)', () => {
  it('formats the exact documented layout', () => {
    expect(formatInMemo(IN)).toBe(GOOD);
  });
  it('round-trips IN', () => {
    expect(parseMemo(formatInMemo(IN))).toEqual({ kind: 'IN', ...IN });
  });
  it('round-trips OUT', () => {
    const sig = '5VERv8NMvzbJMEkV';
    expect(formatOutMemo({ inSigPrefix: sig })).toBe(`SHIFT1|OUT|${sig}`);
    expect(parseMemo(`SHIFT1|OUT|${sig}`)).toEqual({ kind: 'OUT', inSigPrefix: sig });
  });
  it('handles zero baselines, negative tz, u64 max', () => {
    const m = { ...IN, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, tzOffsetMin: -300, budget: 0xffffffffffffffffn };
    expect(parseMemo(formatInMemo(m))).toEqual({ kind: 'IN', ...m });
  });
  it('an IN memo is well under 200 bytes even at worst case widths', () => {
    const worst = formatInMemo({ ...IN, budget: 0xffffffffffffffffn, perSquare: 0xffffffffffffffffn, baseLifeSol: 0xffffffffffffffffn, baseLifeDeployed: 0xffffffffffffffffn, baseOre: 0xffffffffffffffffn, role: 'balanced', tzOffsetMin: -840 });
    expect(worst.length).toBeLessThanOrEqual(200);
  });
  it('formatInMemo refuses to write something the parser would reject', () => {
    expect(() => formatInMemo({ ...IN, squares: 0 })).toThrow();
    expect(() => formatInMemo({ ...IN, localDate: '2026-02-30' })).toThrow();
    expect(() => formatInMemo({ ...IN, budget: 1n << 64n })).toThrow();
  });
});

describe('strict parsing — E-20 look-alikes and malformed input all return null', () => {
  const cases: [string, string][] = [
    ['unknown version', GOOD.replace('SHIFT1', 'SHIFT2')],
    ['lowercase prefix', GOOD.replace('SHIFT1', 'shift1')],
    ['extra leading text', ' ' + GOOD],
    ['trailing space', GOOD + ' '],
    ['trailing newline', GOOD + '\n'],
    ['trailing pipe', GOOD + '|'],
    ['extra field', GOOD + '|1'],
    ['missing field', GOOD.split('|').slice(0, -1).join('|')],
    ['empty string', ''],
    ['just the prefix', 'SHIFT1'],
    ['unknown kind', GOOD.replace('|IN|', '|INN|')],
    ['kind case', GOOD.replace('|IN|', '|in|')],
    ['role case', GOOD.replace('balanced', 'Balanced')],
    ['unknown role', GOOD.replace('balanced', 'whale')],
    ['decimal budget', GOOD.replace('50000000', '0.05')],
    ['leading zero', GOOD.replace('|50000000|', '|050000000|')],
    ['plus sign', GOOD.replace('|12000|', '|+12000|')],
    ['negative amount', GOOD.replace('|12000|', '|-12000|')],
    ['space inside number', GOOD.replace('|12000|', '|12 000|')],
    ['hex number', GOOD.replace('|12000|', '|0x2ee0|')],
    ['empty field', GOOD.replace('|12000|', '||')],
    ['u64 overflow', GOOD.replace('|50000000|', '|18446744073709551616|')],
    ['squares 0', GOOD.replace('|10|1000|', '|0|1000|')],
    ['squares 26', GOOD.replace('|10|1000|', '|26|1000|')],
    ['impossible date', GOOD.replace('2026-10-04', '2026-02-30')],
    ['month 13', GOOD.replace('2026-10-04', '2026-13-04')],
    ['non-padded date', GOOD.replace('2026-10-04', '2026-1-4')],
    ['date with time', GOOD.replace('2026-10-04', '2026-10-04T00:00')],
    ['tz "-0"', GOOD.replace('|60', '|-0')],
    ['tz plus', GOOD.replace('|60', '|+60')],
    ['tz leading zero', GOOD.replace('|60', '|060')],
    ['tz out of range', GOOD.replace('|60', '|841')],
    ['tz fractional', GOOD.replace('|60', '|60.5')],
    ['non-ASCII', GOOD.replace('balanced', 'bаlanced')], // Cyrillic 'а'
    ['emoji', GOOD + '🙂'],
    ['control char', GOOD.replace('SHIFT1|', 'SHIFT1\t|')],
    ['> 200 bytes', GOOD + '|' + 'x'.repeat(200)],
    ['OUT: 15 chars', 'SHIFT1|OUT|5VERv8NMvzbJMEk'],
    ['OUT: 17 chars', 'SHIFT1|OUT|5VERv8NMvzbJMEkVV'],
    ['OUT: non-base58 (0)', 'SHIFT1|OUT|0VERv8NMvzbJMEkV'],
    ['OUT: non-base58 (O)', 'SHIFT1|OUT|OVERv8NMvzbJMEkV'],
    ['OUT: non-base58 (l)', 'SHIFT1|OUT|lVERv8NMvzbJMEkV'],
    ['OUT: extra field', 'SHIFT1|OUT|5VERv8NMvzbJMEkV|x'],
    ['OUT: missing sig', 'SHIFT1|OUT'],
    ['OUT: empty sig', 'SHIFT1|OUT|'],
    ['other app memo', 'hello world'],
    ['json memo', '{"app":"SHIFT1","kind":"IN"}'],
    ['old PRD v1.0 IN shape (10 fields)', 'SHIFT1|IN|balanced|50000000|12000|10|0|0|2026-10-04|60'],
  ];
  for (const [name, text] of cases) {
    it(`rejects: ${name}`, () => {
      expect(parseMemo(text)).toBeNull();
    });
  }
  it('non-string input does not throw', () => {
    expect(parseMemo(undefined as unknown as string)).toBeNull();
    expect(parseMemo(null as unknown as string)).toBeNull();
  });
  it('the GOOD fixture itself parses (guards the table above against a broken baseline)', () => {
    expect(parseMemo(GOOD)).not.toBeNull();
  });
});

describe('extractMemoTexts: RPC memo field "[len] text; [len] text"', () => {
  it('extracts SHIFT1 memos, drops others', () => {
    expect(extractMemoTexts(`[${GOOD.length}] ${GOOD}`)).toEqual([GOOD]);
    expect(extractMemoTexts(`[5] hello; [${GOOD.length}] ${GOOD}`)).toEqual([GOOD]);
    expect(extractMemoTexts(null)).toEqual([]);
    expect(extractMemoTexts('[5] hello')).toEqual([]);
  });
});
