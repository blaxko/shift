import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, retryDelayMs } from './backoff';
import { ORE_APP_URL, clockInBlockReason, type GateInput } from './clockInGate';

describe('E-12 retryDelayMs: 1 / 2 / 4 / 8 s, max 30 s', () => {
  it('doubles from 1 s and caps at 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(BACKOFF_MAX_MS).toBe(30_000);
  });
  it('never returns less than 1 s or more than 30 s, even for nonsense input', () => {
    for (const n of [0, -3, Number.NaN, Infinity, 1e9]) {
      const d = retryDelayMs(n);
      expect(d).toBeGreaterThanOrEqual(1_000);
      expect(d).toBeLessThanOrEqual(30_000);
    }
  });
});

const ok: GateInput = { mainnet: true, crankConfigured: true, maintenance: false, planOk: true, chainLoaded: true, blockedByExisting: false, insufficientBalance: false };

describe('clockInBlockReason', () => {
  it('everything fine -> enabled (empty reason)', () => {
    expect(clockInBlockReason(ok)).toBe('');
  });
  it('E-23: on devnet ORE shifts are disabled with a clear reason, and this wins over everything else', () => {
    expect(clockInBlockReason({ ...ok, mainnet: false })).toMatch(/only runs on mainnet/);
    expect(clockInBlockReason({ ...ok, mainnet: false, crankConfigured: false, maintenance: true })).toMatch(/only runs on mainnet/);
  });
  it('each other rule, in priority order', () => {
    expect(clockInBlockReason({ ...ok, crankConfigured: false })).toBe('The SHIFT executor is not configured in this build');
    expect(clockInBlockReason({ ...ok, maintenance: true })).toBe('ORE maintenance mode'); // E-11
    expect(clockInBlockReason({ ...ok, planOk: false })).toBe('Choose a valid shift');
    expect(clockInBlockReason({ ...ok, chainLoaded: false })).toBe('Checking your wallet…');
    expect(clockInBlockReason({ ...ok, blockedByExisting: true })).toBe('You already have an ORE automation'); // E-6
    expect(clockInBlockReason({ ...ok, insufficientBalance: true })).toBe('Not enough SOL'); // E-5
  });
  it('maintenance beats a missing chain read; blocked-by-existing beats insufficient balance', () => {
    expect(clockInBlockReason({ ...ok, maintenance: true, chainLoaded: false })).toBe('ORE maintenance mode');
    expect(clockInBlockReason({ ...ok, blockedByExisting: true, insufficientBalance: true })).toBe('You already have an ORE automation');
  });
});

describe('E-6 link target', () => {
  it('points at ORE over https', () => {
    expect(ORE_APP_URL).toBe('https://ore.com');
  });
});
