import { describe, expect, it } from 'vitest';
import { contrastRatio, palette } from '../config/theme';

describe('contrastRatio (WCAG maths)', () => {
  it('known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThan(4.5); // the classic AA grey
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.6);
    expect(() => contrastRatio('red', '#fff')).toThrow();
  });
});

describe('NFR-A3: every text colour meets 4.5:1 on every surface it is drawn on, in BOTH themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const p = palette[mode];
    // text colour -> surfaces it appears on (bg = screen, card = Card/Banner/Choice backgrounds, primary = filled button)
    const pairs: [string, string, string][] = [
      ['text', p.text, p.bg],
      ['text', p.text, p.card],
      ['muted', p.muted, p.bg],
      ['muted', p.muted, p.card],
      ['primary (outline button / selected label)', p.primary, p.bg],
      ['primary on card', p.primary, p.card],
      ['onPrimary on primary (filled button)', p.onPrimary, p.primary],
      ['danger (errors)', p.danger, p.bg],
      ['danger on card (error banner)', p.danger, p.card],
      ['warn (notices)', p.warn, p.bg],
      ['warn on card (notice banner)', p.warn, p.card],
      ['ok', p.ok, p.bg],
      ['ok on card', p.ok, p.card],
    ];
    for (const [name, fg, bg] of pairs) {
      it(`${mode}: ${name} ${fg} on ${bg} >= 4.5:1`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${mode}: UI borders (selected-choice outline, card edge, button outline) >= 3:1 against both surfaces (WCAG 1.4.11)`, () => {
      expect(contrastRatio(p.border, p.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.border, p.card)).toBeGreaterThanOrEqual(3);
    });
  }
});
