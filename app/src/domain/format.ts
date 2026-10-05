// Amount formatting. Lamports are always bigint; never go through floating point.

const LAMPORTS_PER_SOL_DIGITS = 9;

/** Round-half-up to `dp` decimals (0..9). 50_000_000n -> "0.0500". AC-2.1 uses dp = 4. */
export function formatSol(lamports: bigint, dp = 4): string {
  if (dp < 0 || dp > LAMPORTS_PER_SOL_DIGITS) throw new RangeError('dp must be 0..9');
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const scale = 10n ** BigInt(LAMPORTS_PER_SOL_DIGITS - dp);
  const rounded = (abs + scale / 2n) / scale;
  const unit = 10n ** BigInt(dp);
  const whole = rounded / unit;
  const frac = dp === 0 ? '' : '.' + (rounded % unit).toString().padStart(dp, '0');
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Exact value, trailing zeros trimmed (min 2 decimals): 6_134_800n -> "0.0061348". For fee lines where 4 dp would hide detail. */
export function formatSolExact(lamports: bigint): string {
  const s = formatSol(lamports, 9).replace(/0+$/, '');
  const [w, f = ''] = s.split('.');
  return `${w}.${f.padEnd(2, '0')}`;
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** NFR-A2: "zero point zero five SOL". Reads the exact value digit by digit so TalkBack never mangles it. */
export function speakSol(lamports: bigint): string {
  const neg = lamports < 0n;
  const body = formatSol(neg ? -lamports : lamports, 9).replace(/0+$/, '').replace(/\.$/, ''); // "0.050000000" -> "0.05"; "1.000000000" -> "1"
  const words = body
    .split('')
    .map((ch) => (ch === '.' ? 'point' : DIGIT_WORDS[Number(ch)]))
    .join(' ');
  return `${neg ? 'minus ' : ''}${words} SOL`;
}

/** 60 -> "1 h", 240 -> "4 h", 90 -> "1 h 30 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** Fee share in basis points -> "1.8 %". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} %`;
}
