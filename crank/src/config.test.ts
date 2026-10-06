import { Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { base58Encode } from '../../scripts/gen-executor-key.mjs';
import { base58Decode } from './base58';
import { ConfigError, LIVE_ACK, LOW_BALANCE_LAMPORTS, MAX_PRIORITY_FEE_MICROLAMPORTS, describeConfig, parseConfig } from './config';
import { consoleLogger, redact } from './log';

// Ephemeral keys generated INSIDE the test process only to exercise parsing; they are never persisted or printed.
const kp = Keypair.generate();
const secretJson = JSON.stringify(Array.from(kp.secretKey));
const secretB58 = base58Encode(kp.secretKey) as string;
const base = { RPC_URL: 'https://rpc.example/path?api-key=SUPERSECRETKEY' };

describe('dry-run is the default (money-safety)', () => {
  it('no DRY_RUN set -> dry run, no keypair held even if a secret is provided', () => {
    const c = parseConfig({ ...base, EXECUTOR_KEYPAIR: secretJson });
    expect(c.live).toBe(false);
    expect(c.keypair).toBeNull(); // the secret is dropped in dry-run
    expect(c.executorPubkey.equals(kp.publicKey)).toBe(true);
  });
  it.each(['1', 'true', ''])('DRY_RUN=%j -> dry run', (v) => {
    expect(parseConfig({ ...base, DRY_RUN: v, EXECUTOR_PUBKEY: kp.publicKey.toBase58() }).live).toBe(false);
  });
  it('dry run needs only the PUBLIC key (the secret never has to exist on this machine)', () => {
    const c = parseConfig({ ...base, EXECUTOR_PUBKEY: kp.publicKey.toBase58() });
    expect(c.live).toBe(false);
    expect(c.keypair).toBeNull();
  });
});

describe('live mode is locked behind TWO explicit switches', () => {
  it('DRY_RUN=0 alone refuses to start (never silently live, never silently dry)', () => {
    expect(() => parseConfig({ ...base, DRY_RUN: '0', EXECUTOR_KEYPAIR: secretJson })).toThrowError(/ACKNOWLEDGE_LIVE/);
  });
  it('a wrong acknowledgement string refuses to start', () => {
    expect(() => parseConfig({ ...base, DRY_RUN: '0', ACKNOWLEDGE_LIVE: 'yes', EXECUTOR_KEYPAIR: secretJson })).toThrowError(ConfigError);
  });
  it('both switches + the secret -> live', () => {
    const c = parseConfig({ ...base, DRY_RUN: '0', ACKNOWLEDGE_LIVE: LIVE_ACK, EXECUTOR_KEYPAIR: secretJson });
    expect(c.live).toBe(true);
    expect(c.keypair?.publicKey.equals(kp.publicKey)).toBe(true);
  });
  it('live without a secret refuses (a public key alone cannot sign)', () => {
    expect(() => parseConfig({ ...base, DRY_RUN: '0', ACKNOWLEDGE_LIVE: LIVE_ACK, EXECUTOR_PUBKEY: kp.publicKey.toBase58() })).toThrowError(/EXECUTOR_KEYPAIR/);
  });
  it('garbage DRY_RUN values are errors, not "probably dry"', () => {
    for (const v of ['yes', 'no', 'maybe', '2', 'FALSE']) expect(() => parseConfig({ ...base, DRY_RUN: v, EXECUTOR_PUBKEY: kp.publicKey.toBase58() }), v).toThrowError(/DRY_RUN/);
  });
});

describe('executor key parsing (FR-4.4: base58 or JSON)', () => {
  it('JSON array and base58 give the same key', () => {
    expect(parseConfig({ ...base, EXECUTOR_KEYPAIR: secretB58 }).executorPubkey.equals(kp.publicKey)).toBe(true);
    expect(parseConfig({ ...base, EXECUTOR_KEYPAIR: secretJson }).executorPubkey.equals(kp.publicKey)).toBe(true);
  });
  it('base58 encoder (script) and decoder (crank) round-trip; known vectors', () => {
    expect([...base58Decode(secretB58)]).toEqual([...kp.secretKey]);
    expect(base58Encode(new TextEncoder().encode('hello world'))).toBe('StV1DL6CwTryKyV');
    expect(base58Encode(Uint8Array.from([0, 0, 0]))).toBe('111');
    expect([...base58Decode('111')]).toEqual([0, 0, 0]);
    expect(base58Encode(new Uint8Array(32))).toBe('11111111111111111111111111111111'); // system program id
  });
  it('mismatched pubkey/secret refuses', () => {
    expect(() => parseConfig({ ...base, EXECUTOR_KEYPAIR: secretJson, EXECUTOR_PUBKEY: Keypair.generate().publicKey.toBase58() })).toThrowError(/does not match/);
  });
  it('bad keys fail with a message that NEVER echoes the input', () => {
    for (const bad of ['not-a-key', '[1,2,3]', '[' + 'x,'.repeat(63) + 'x]', secretB58.slice(0, -3), secretJson.replace(']', ',1]')]) {
      try {
        parseConfig({ ...base, EXECUTOR_KEYPAIR: bad });
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as Error).message).not.toContain(bad.slice(0, 12));
        expect((e as Error).message).toMatch(/EXECUTOR_KEYPAIR/);
      }
    }
  });
  it('no identity at all is an error', () => {
    expect(() => parseConfig(base)).toThrowError(/EXECUTOR_PUBKEY/);
  });
});

describe('other settings (FR-4.4)', () => {
  const ok = { ...base, EXECUTOR_PUBKEY: kp.publicKey.toBase58() };
  it('defaults', () => {
    const c = parseConfig(ok);
    expect(c).toMatchObject({ port: 8080, priorityFeeMicroLamports: 1000, pollMs: 2000, maxItemsPerTx: 5 });
    expect(c.lowBalanceLamports).toBe(10_000_000n); // 0.01 SOL
    expect(LOW_BALANCE_LAMPORTS).toBe(10_000_000n);
  });
  it('validates numbers and caps the priority fee (fat-finger protection)', () => {
    expect(() => parseConfig({ ...ok, PORT: 'abc' })).toThrow();
    expect(() => parseConfig({ ...ok, PORT: '0' })).toThrow();
    expect(() => parseConfig({ ...ok, PRIORITY_FEE_MICROLAMPORTS: String(MAX_PRIORITY_FEE_MICROLAMPORTS + 1) })).toThrow();
    expect(parseConfig({ ...ok, PRIORITY_FEE_MICROLAMPORTS: String(MAX_PRIORITY_FEE_MICROLAMPORTS) }).priorityFeeMicroLamports).toBe(MAX_PRIORITY_FEE_MICROLAMPORTS);
    expect(() => parseConfig({ ...ok, PRIORITY_FEE_MICROLAMPORTS: '-1' })).toThrow();
  });
  it('RPC_URL is required and must be http(s)', () => {
    expect(() => parseConfig({ EXECUTOR_PUBKEY: kp.publicKey.toBase58() })).toThrow(/RPC_URL/);
    expect(() => parseConfig({ ...ok, RPC_URL: 'ws://x' })).toThrow(/RPC_URL/);
  });
});

describe('NFR-S5: nothing secret is ever logged', () => {
  it('describeConfig contains no secret and strips the RPC path/query (API keys live there)', () => {
    const c = parseConfig({ ...base, DRY_RUN: '0', ACKNOWLEDGE_LIVE: LIVE_ACK, EXECUTOR_KEYPAIR: secretB58 });
    const text = JSON.stringify(describeConfig(c));
    expect(text).not.toContain(secretB58);
    expect(text).not.toContain(secretB58.slice(0, 20));
    expect(text).not.toContain('SUPERSECRETKEY');
    expect(text).toContain('https://rpc.example');
    expect(text).toContain(kp.publicKey.toBase58());
  });
  it('the logger redacts suspicious keys and serialises bigint', () => {
    const lines: string[] = [];
    consoleLogger((l) => lines.push(l)).info('x', { secretKey: secretB58, keypair: secretJson, apiKey: 'k', lamports: 5n, ok: 'fine' });
    expect(lines[0]).not.toContain(secretB58);
    expect(lines[0]).not.toContain('"k"');
    expect(JSON.parse(lines[0]!)).toMatchObject({ lamports: '5', ok: 'fine', secretKey: '[redacted]' });
    expect(redact(undefined)).toBeUndefined();
  });
});
