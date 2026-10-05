import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ORE_PROGRAM_ID, decode } from '@shift/codec';
import { describe, expect, it } from 'vitest';
import { deserializeAuth, serializeAuth } from './authCache';
import { classifyExisting } from './conflict';
import { formatBps, formatMinutes, formatSol, formatSolExact, formatSolUp, speakSol } from './format';
import { classifyWalletError } from './walletErrors';

const fx = (name: string) => {
  const j = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'codec', 'test', 'fixtures', name), 'utf8')) as { dataBase64: string };
  return decode.automation({ owner: ORE_PROGRAM_ID, data: Buffer.from(j.dataBase64, 'base64') });
};

describe('format', () => {
  it('formatSol rounds half-up to 4 dp (AC-2.1)', () => {
    expect(formatSol(20_000_000n)).toBe('0.0200');
    expect(formatSol(50_000_000n)).toBe('0.0500');
    expect(formatSol(100_000_000n)).toBe('0.1000');
    expect(formatSol(500_000_000n)).toBe('0.5000');
    expect(formatSol(6_134_800n)).toBe('0.0061');
    expect(formatSol(49_999n)).toBe('0.0000');
    expect(formatSol(50_000n)).toBe('0.0001'); // half-up
    expect(formatSol(0n)).toBe('0.0000');
    expect(formatSol(1_500_000_000n)).toBe('1.5000');
    expect(formatSol(-1_500_000n, 3)).toBe('-0.002');
    expect(formatSol(123_456_789n, 9)).toBe('0.123456789');
    expect(formatSol(5n, 0)).toBe('0');
  });
  it('formatSolUp never understates a shortfall (AC-2.3)', () => {
    expect(formatSolUp(1n)).toBe('0.0001');
    expect(formatSolUp(100_000n)).toBe('0.0001'); // exact multiple stays
    expect(formatSolUp(100_001n)).toBe('0.0002');
    expect(formatSolUp(0n)).toBe('0.0000');
    expect(formatSolUp(18_149_280n)).toBe('0.0182');
    expect(formatSol(18_149_280n)).toBe('0.0181'); // plain rounding would understate
  });
  it('formatSolExact keeps all significant digits', () => {
    expect(formatSolExact(6_134_800n)).toBe('0.0061348');
    expect(formatSolExact(2_004_480n)).toBe('0.00200448');
    expect(formatSolExact(50_000_000n)).toBe('0.05');
    expect(formatSolExact(1_000_000_000n)).toBe('1.00');
  });
  it('speakSol reads digit by digit with units (NFR-A2)', () => {
    expect(speakSol(50_000_000n)).toBe('zero point zero five SOL');
    expect(speakSol(1_000_000_000n)).toBe('one SOL');
    expect(speakSol(0n)).toBe('zero SOL');
    expect(speakSol(6_134_800n)).toBe('zero point zero zero six one three four eight SOL');
    expect(speakSol(10_000_000_000n)).toBe('one zero SOL');
  });
  it('minutes and bps', () => {
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(480)).toBe('8 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatBps(184)).toBe('1.8 %');
    expect(formatBps(500)).toBe('5 %');
  });
});

describe('classifyExisting (FR-3.1, E-6, AC-3.5) on real fixtures', () => {
  const crank = Keypair.generate().publicKey;
  const idle = fx('automation-2fFYVW8S.json'); // balance 0, executor == owner
  const funded = fx('automation-4dPdFJ7N.json'); // balance > 0, foreign executor
  it('no automation -> none', () => expect(classifyExisting(null, crank, crank)).toEqual({ kind: 'none' }));
  it('idle shell (balance 0, executor == owner) -> idle-shell', () => {
    expect(idle.balance).toBe(0n);
    expect(classifyExisting(idle, idle.authority, crank)).toEqual({ kind: 'idle-shell' });
  });
  it('funded foreign automation -> blocked / foreign', () => {
    expect(classifyExisting(funded, funded.authority, crank)).toEqual({ kind: 'blocked', why: 'foreign' });
  });
  it('permissionless-executor automation -> blocked / foreign', () => {
    expect(classifyExisting(fx('automation-5dV8F9Uj.json'), PublicKey.default, crank)).toEqual({ kind: 'blocked', why: 'foreign' });
  });
  it('a running SHIFT automation (executor == crank) -> blocked / shift-active', () => {
    expect(classifyExisting({ ...funded, executor: crank }, funded.authority, crank)).toEqual({ kind: 'blocked', why: 'shift-active' });
  });
  it('balance 0 with a foreign executor is NOT an idle shell', () => {
    expect(classifyExisting({ ...idle, executor: crank }, idle.authority, crank)).toEqual({ kind: 'blocked', why: 'shift-active' });
    expect(classifyExisting({ ...idle, executor: funded.executor }, idle.authority, crank)).toEqual({ kind: 'blocked', why: 'foreign' });
  });
  it('without a configured crank key nothing is classed shift-active', () => {
    expect(classifyExisting({ ...funded, executor: crank }, funded.authority)).toEqual({ kind: 'blocked', why: 'foreign' });
  });
});

describe('classifyWalletError (AC-1.3, AC-1.4)', () => {
  it('no wallet installed: by code and by the message seen on device', () => {
    expect(classifyWalletError({ code: 'ERROR_WALLET_NOT_FOUND', message: 'x' }).code).toBe('NO_WALLET');
    const real = new Error('Found no installed wallet that supports the mobile wallet protocol.');
    const e = classifyWalletError(real);
    expect(e.code).toBe('NO_WALLET');
    expect(e.userMessage).toBe('No compatible wallet found');
    expect(e.detail).toContain('Found no installed wallet');
  });
  it('user declines: protocol -1 / -3 and association cancelled', () => {
    expect(classifyWalletError(Object.assign(new Error('declined'), { code: -1 })).code).toBe('USER_REJECTED');
    expect(classifyWalletError(Object.assign(new Error('declined'), { code: -3 })).code).toBe('USER_REJECTED');
    expect(classifyWalletError(Object.assign(new Error('x'), { code: 'ERROR_ASSOCIATION_CANCELLED' })).code).toBe('USER_REJECTED');
    expect(classifyWalletError({ code: -1 }).userMessage).toBe('Cancelled — nothing was sent');
  });
  it('anything else is UNKNOWN with a friendly message; raw text only in detail', () => {
    const e = classifyWalletError(new Error('socket hang up at 0x7f'));
    expect(e.code).toBe('UNKNOWN');
    expect(e.userMessage).not.toContain('socket');
    expect(e.detail).toContain('socket hang up');
    expect(classifyWalletError(null).code).toBe('UNKNOWN');
    expect(classifyWalletError('boom').code).toBe('UNKNOWN');
  });
});

describe('auth cache serialisation (FR-1.2, AC-1.5)', () => {
  const pk = Keypair.generate().publicKey;
  const addressBase64 = Buffer.from(pk.toBytes()).toString('base64');
  const auth = {
    authToken: 'tok-123',
    accounts: [{ address: pk, publicKey: pk, addressBase64, label: 'Main' }],
    selectedAccount: { address: pk, publicKey: pk, addressBase64, label: 'Main' },
  } as never;
  it('round-trips token + address', () => {
    const back = deserializeAuth(serializeAuth(auth))!;
    expect(back.authToken).toBe('tok-123');
    expect(back.selectedAccount.address.equals(pk)).toBe(true);
    expect(back.accounts).toHaveLength(1);
    expect(back.selectedAccount.label).toBe('Main');
  });
  it('stores nothing but token + addresses (no key material exists to store)', () => {
    const raw = serializeAuth(auth);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['accounts', 'authToken', 'selected', 'v']);
  });
  it('anything unreadable means no cached auth (never throws)', () => {
    for (const bad of [null, undefined, '', 'not json', '{}', '{"v":2}', '{"v":1,"authToken":"","accounts":[{"addressBase64":"AA=="}],"selected":"AA=="}', '{"v":1,"authToken":"t","accounts":[],"selected":""}', '{"v":1,"authToken":"t","accounts":[{"addressBase64":"!!!"}],"selected":"!!!"}'])
      expect(deserializeAuth(bad as string)).toBeUndefined();
  });
  it('falls back to the first account if the selected one is missing', () => {
    const raw = JSON.parse(serializeAuth(auth));
    raw.selected = 'zzz';
    expect(deserializeAuth(JSON.stringify(raw))!.selectedAccount.address.equals(pk)).toBe(true);
  });
});
