// Structure checks only. This test NEVER runs the script (no key is generated) — it reads the source and tests the pure encoder.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no types
import { base58Encode } from './gen-executor-key.mjs';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gen-executor-key.mjs'), 'utf8');

describe('gen-executor-key.mjs (run by the user, not by Claude)', () => {
  it('importing it has no side effects (main() is guarded) — so this test generates nothing', () => {
    expect(src).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href\) main\(\)/);
  });
  it('writes to <home>/shift-secrets/executor.json, outside the repo', () => {
    expect(src).toContain("join(homedir(), 'shift-secrets')");
    expect(src).toContain("join(dir, 'executor.json')");
  });
  it('refuses to overwrite: checked before generating AND at write time (flag "wx")', () => {
    expect(src).toMatch(/if \(existsSync\(file\)\)[\s\S]*process\.exit\(1\)/);
    expect(src.indexOf('existsSync(file)')).toBeLessThan(src.indexOf('Keypair.generate()'));
    expect(src).toContain("flag: 'wx'");
  });
  it('owner-only file mode', () => {
    expect(src).toContain('mode: 0o600');
  });
  it('prints the secret ONLY behind --print-secret-for-env', () => {
    const lines = src.split('\n').filter((l) => /base58Encode\(kp\.secretKey\)/.test(l) && /console\./.test(l));
    expect(lines).toHaveLength(1);
    const idx = src.indexOf(lines[0]!);
    expect(src.lastIndexOf('if (printSecret)', idx)).toBeGreaterThan(src.lastIndexOf('console.log(`  ${file}`)'));
    // no other console call mentions the secret
    // (labels such as "Secret key file" are fine; identifiers holding the secret value are not)
    expect(src.match(/console\.\w+\([^;]*(secretKey|base58Encode)/g)?.length ?? 0).toBe(1);
  });
  it('rejects unknown arguments (a typo can never silently print the secret)', () => {
    expect(src).toContain('Unknown argument(s)');
  });
  it('base58 encoder known vectors', () => {
    expect(base58Encode(new TextEncoder().encode('hello world'))).toBe('StV1DL6CwTryKyV');
    expect(base58Encode(Uint8Array.from([0, 0, 0]))).toBe('111');
    expect(base58Encode(new Uint8Array(32))).toBe('11111111111111111111111111111111');
  });
});
