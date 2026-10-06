// Colour tokens (pure, no React Native import) so contrast can be unit-tested. NFR-A3: text >= 4.5:1 (WCAG AA) in light AND dark;
// UI component borders >= 3:1 (WCAG 1.4.11). Verified by theme.test.ts, which fails if a token drifts below the bar.
export const palette = {
  light: { bg: '#FFFFFF', card: '#F3F4F6', text: '#111827', muted: '#4B5563', primary: '#0B5FFF', onPrimary: '#FFFFFF', danger: '#B00020', warn: '#8A4B00', ok: '#0B6B2E', border: '#6B7280' },
  dark: { bg: '#0B0F14', card: '#1A212B', text: '#F3F4F6', muted: '#A7B0BD', primary: '#7FB0FF', onPrimary: '#0B0F14', danger: '#FF9AA2', warn: '#FFC266', ok: '#7EE2A0', border: '#8A94A3' },
} as const;

export type Palette = (typeof palette)['light'] | (typeof palette)['dark'];

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new RangeError(`bad colour ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
