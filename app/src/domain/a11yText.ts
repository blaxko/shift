// NFR-A2: amounts are read WITH UNITS and digit by digit ("zero point zero two zero zero SOL"). Screens show "0.0200 SOL"; TalkBack
// would otherwise read a number string unpredictably. These pure helpers turn displayed text into the spoken label.

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const spokenNumber = (s: string) =>
  s
    .split('')
    .map((ch) => (ch === '.' ? 'point' : DIGIT_WORDS[Number(ch)]))
    .join(' ');

/**
 * Replace every "<number> SOL|ORE" and "<number> %" in `text` with its spoken form.
 * "You put in 0.0200 SOL (0.2 %)" -> "You put in zero point zero two zero zero SOL (zero point two percent)".
 * Handles a leading minus (ASCII or U+2212) and plus sign.
 */
export function speakAmountsInText(text: string): string {
  return text
    .replace(/([−-]|\+)?(\d+(?:\.\d+)?)\s(SOL|ORE)\b/g, (_m, sign: string | undefined, num: string, unit: string) => `${sign === '+' ? 'plus ' : sign ? 'minus ' : ''}${spokenNumber(num)} ${unit}`)
    .replace(/(\d+(?:\.\d+)?)\s%/g, (_m, num: string) => `${spokenNumber(num)} percent`);
}

/** True if the text contains an amount that needs a spoken label. */
export const hasSpokenAmount = (text: string) => /\d(?:\.\d+)?\s(?:SOL|ORE|%)/.test(text);

/**
 * React children -> plain text, only when ALL children are strings/numbers. Anything else (nested elements) returns null:
 * the caller then leaves the default label alone instead of hiding content from TalkBack.
 */
export function flattenChildren(children: unknown): string | null {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    const parts = children.map((c) => (c === null || c === undefined || c === false || c === true ? '' : flattenChildren(c)));
    return parts.some((p) => p === null) ? null : parts.join('');
  }
  return null;
}

/** Spoken label for a text node, or undefined if no override is needed. */
export function autoSpokenLabel(children: unknown): string | undefined {
  const text = flattenChildren(children);
  return text !== null && hasSpokenAmount(text) ? speakAmountsInText(text) : undefined;
}
