import { describe, expect, it } from 'vitest';
import { autoSpokenLabel, flattenChildren, hasSpokenAmount, speakAmountsInText } from './a11yText';

describe('speakAmountsInText (NFR-A2)', () => {
  it('amounts are spelled out digit by digit with units', () => {
    expect(speakAmountsInText('Max you can lose: 0.0200 SOL')).toBe('Max you can lose: zero point zero two zero zero SOL');
    expect(speakAmountsInText('You need 0.0160 SOL more')).toBe('You need zero point zero one six zero SOL more');
    expect(speakAmountsInText('0.0120 ORE earned')).toBe('zero point zero one two zero ORE earned');
    expect(speakAmountsInText('1 SOL')).toBe('one SOL');
  });
  it('several amounts in one sentence', () => {
    expect(speakAmountsInText('You put in 0.0500 SOL. You got back 0.0350 SOL + 0.0120 ORE.')).toBe(
      'You put in zero point zero five zero zero SOL. You got back zero point zero three five zero SOL + zero point zero one two zero ORE.',
    );
  });
  it('signs are words (never a bare symbol): minus, plus', () => {
    expect(speakAmountsInText('Net loss −0.015046 SOL')).toBe('Net loss minus zero point zero one five zero four six SOL');
    expect(speakAmountsInText('-0.5 SOL')).toBe('minus zero point five SOL');
    expect(speakAmountsInText('Net gain +0.002 SOL')).toBe('Net gain plus zero point zero zero two SOL');
  });
  it('percentages', () => {
    expect(speakAmountsInText('Executor fees 0.000046 SOL (0.2 % of budget)')).toBe('Executor fees zero point zero zero zero zero four six SOL (zero point two percent of budget)');
    expect(speakAmountsInText('under 5 % of each round')).toBe('under five percent of each round');
  });
  it('text without amounts is untouched; "SOL" without a number is untouched; word boundaries respected', () => {
    expect(speakAmountsInText('Connect your wallet')).toBe('Connect your wallet');
    expect(speakAmountsInText('Mining SOL and ORE')).toBe('Mining SOL and ORE');
    expect(speakAmountsInText('5 SOLID')).toBe('5 SOLID');
    expect(speakAmountsInText('Round 428 288 deployed')).toBe('Round 428 288 deployed');
  });
});

describe('flattenChildren / autoSpokenLabel (what the Text components pass)', () => {
  it('strings, numbers and arrays of them (JSX interpolation) are flattened', () => {
    expect(flattenChildren('a')).toBe('a');
    expect(flattenChildren(5)).toBe('5');
    expect(flattenChildren(['Max you can lose: ', '0.0200', ' SOL'])).toBe('Max you can lose: 0.0200 SOL');
    expect(flattenChildren(['x', null, false, undefined, 'y'])).toBe('xy');
  });
  it('anything containing an element is NOT flattened (we never hide content from TalkBack)', () => {
    expect(flattenChildren({ type: 'Text' })).toBeNull();
    expect(flattenChildren(['a', { type: 'Text' }])).toBeNull();
    expect(autoSpokenLabel(['a', { type: 'Text' }])).toBeUndefined();
  });
  it('a label is produced only when an amount is present', () => {
    expect(autoSpokenLabel(['Max you can lose: ', '0.0200', ' SOL'])).toBe('Max you can lose: zero point zero two zero zero SOL');
    expect(autoSpokenLabel('Hello')).toBeUndefined();
    expect(hasSpokenAmount('0.5 SOL')).toBe(true);
    expect(hasSpokenAmount('0.5')).toBe(false);
  });
});
