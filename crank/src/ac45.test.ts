// AC-4.5 / NFR-S6 / FR-4.3: "The crank sends only Deploy and Checkpoint instructions; no code path may transfer, claim,
// withdraw, or close user funds." Enforced on the crank's SOURCE so a future edit that adds a forbidden builder fails CI.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !/\.(test|testkit)\.ts$/.test(f))
  .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

/** Every builder exported by @shift/codec's ix.ts. Only the first two may appear in the crank. */
const BUILDERS = ['automate', 'stopAutomation', 'executorDeploy', 'checkpoint', 'claimSol', 'claimOre', 'shiftMemo', 'associatedTokenAddress'];
const ALLOWED_BUILDERS = ['executorDeploy', 'checkpoint'];

function codecImports(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@shift\/codec'/g)) names.push(...m[1]!.split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!).filter(Boolean));
  return names;
}

describe('AC-4.5: the crank can only build Deploy and Checkpoint', () => {
  it('scans real source files (not vacuous)', () => {
    expect(sources.map((s) => s.f)).toEqual(expect.arrayContaining(['batch.ts', 'loop.ts', 'plan.ts', 'submit.ts', 'index.ts']));
  });
  it('imports only executorDeploy and checkpoint among the codec instruction builders', () => {
    const used = new Set(sources.flatMap((s) => codecImports(s.text)));
    for (const b of BUILDERS) expect(used.has(b), `forbidden builder ${b}`).toBe(b === 'executorDeploy' || b === 'checkpoint' ? true : false);
    expect([...used].filter((n) => BUILDERS.includes(n)).sort()).toEqual([...ALLOWED_BUILDERS].sort());
  });
  it('no namespace/deep/dynamic imports of the codec that would hide a builder', () => {
    for (const s of sources) {
      expect(s.text, s.f).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+'@shift\/codec/);
      expect(s.text, s.f).not.toMatch(/from\s+'@shift\/codec\//);
      expect(s.text, s.f).not.toMatch(/require\(\s*'@shift\/codec/);
      expect(s.text, s.f).not.toMatch(/import\(\s*'@shift\/codec/);
    }
  });
  it('no transfer / claim / withdraw / close code and no SystemProgram anywhere in the crank', () => {
    for (const s of sources) {
      const noComments = s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(noComments, s.f).not.toMatch(/SystemProgram|\.transfer\(|claimSol|claimOre|stopAutomation|withdraw|sendAndConfirm.*Transfer/i);
    }
  });
  it('web3.js instruction sources are limited to ComputeBudgetProgram (priority fee) and the TransactionInstruction type', () => {
    for (const s of sources) {
      for (const m of s.text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@solana\/web3\.js'/g)) {
        const names = m[1]!.split(',').map((x) => x.trim().replace(/^type\s+/, ''));
        for (const n of names) expect(['Keypair', 'PublicKey', 'Connection', 'ComputeBudgetProgram', 'TransactionMessage', 'VersionedTransaction', 'TransactionInstruction', '']).toContain(n);
      }
    }
  });
  it('the secret key is only handled in config.ts and submit.ts (live path); never logged', () => {
    for (const s of sources) {
      const code = s.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // the rule is about code, not comments
      if (!['config.ts', 'submit.ts', 'index.ts'].includes(s.f)) expect(code, s.f).not.toMatch(/secretKey|EXECUTOR_KEYPAIR/);
      expect(s.text, s.f).not.toMatch(/log\.\w+\([^)]*(secretKey|keypair)/i);
    }
  });
});
