import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { CONTENT_ALLOWLIST, findInText, isKeyFile, mask } from './secret-scan.mjs';

// All samples are synthetic: random-looking but not real keys.
const json64 = JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));
const b58 = 'Zq'.repeat(44); // 88 chars of base58 alphabet

describe('secret-scan rules', () => {
  it('flags a 64-number JSON byte array (a Solana keypair file)', () => {
    expect(findInText(json64).map((f: { rule: string }) => f.rule)).toContain('solana-secret-json');
    expect(findInText(`const k = ${json64};`).length).toBeGreaterThan(0);
  });
  it('does NOT flag short arrays, 32-number arrays, or ordinary numbers', () => {
    expect(findInText('[1,2,3,4,5]')).toEqual([]);
    expect(findInText(JSON.stringify(Array.from({ length: 32 }, (_, i) => i)))).toEqual([]);
    expect(findInText('lamports: 5_000_000')).toEqual([]);
  });
  it('flags EXECUTOR_KEYPAIR with a value, but not the empty placeholder in .env.example', () => {
    expect(findInText(`EXECUTOR_KEYPAIR=${b58}`).map((f: { rule: string }) => f.rule)).toContain('keypair-env-assignment');
    expect(findInText(`EXECUTOR_KEYPAIR=[1,2,3`).length).toBeGreaterThan(0);
    expect(findInText('EXECUTOR_KEYPAIR=')).toEqual([]);
    expect(findInText('# EXECUTOR_KEYPAIR is read from the environment')).toEqual([]);
  });
  it('flags a base58 string next to secret-ish words, not a bare transaction signature', () => {
    expect(findInText(`const secretKey = "${b58}"`).map((f: { rule: string }) => f.rule)).toContain('base58-secret-near-keyword');
    expect(findInText(`signature: '${b58}'`)).toEqual([]);
  });
  it('flags API keys in URLs, PEM private keys', () => {
    expect(findInText('https://rpc.example/?api-key=abcdef0123456789abcdef').length).toBeGreaterThan(0);
    expect(findInText('-----BEGIN PRIVATE KEY-----').length).toBeGreaterThan(0);
    expect(findInText('RPC_URL=https://api.mainnet-beta.solana.com')).toEqual([]);
  });
  it('findings carry a masked match, never the secret itself', () => {
    const f = findInText(`EXECUTOR_KEYPAIR=${b58}`)[0];
    expect(f.masked).not.toContain(b58);
    expect(mask('abcdefghijkl')).toBe('abcd…[12 chars masked]');
  });
  it('key files: executor.json, id.json, *keypair*.json, .env, *.pem/.key are flagged; .env.example is allowed', () => {
    for (const p of ['executor.json', 'shift-secrets/executor.json', 'id.json', 'my-keypair.json', '.env', 'crank/.env.production', 'x/server.pem', 'a/b.key']) expect(isKeyFile(p), p).toBe(true);
    for (const p of ['.env.example', 'crank/.env.example', 'package.json', 'app/app.json', 'packages/codec/test/fixtures/miner-9MbHiQxn.json']) expect(isKeyFile(p), p).toBe(false);
  });
});

describe('content allow-list', () => {
  it('is exactly the scanner and its own test, nothing else', () => {
    expect([...CONTENT_ALLOWLIST].sort()).toEqual(['scripts/secret-scan.mjs', 'scripts/secret-scan.test.ts']);
  });
  it('key-file NAMES are still checked for every path (the allow-list only skips content)', () => {
    expect(isKeyFile('scripts/executor.json')).toBe(true);
  });
});
