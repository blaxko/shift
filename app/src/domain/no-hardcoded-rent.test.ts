// Drift guard (device S-2 finding, 2026-10-06): rent is a cluster parameter (6960 -> 5080 lamports/byte changed the displayed
// costs by 27 %). No rent literal may live in shipped source. Tests/docs may mention values as labelled test data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCAN = ['app/src', 'app/app', 'app/components', 'app/features', 'packages/codec/src', 'crank/src'];
// Rent-exempt minimum for the Automation (160 B) and Miner (752 B) accounts under either known per-byte price, with the
// common digit-grouping styles (1_463_040, 1 463 040, 1463040).
const RENT_LITERAL = /\b(6[_ ,]?124[_ ,]?800|2[_ ,]?004[_ ,]?480|1[_ ,]?463[_ ,]?040|4[_ ,]?470[_ ,]?400|6960|5080)\b/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      yield* files(p);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) yield p;
  }
}

describe('no hard-coded rent in shipped source', () => {
  it('scans real files (guards against a vacuous pass)', () => {
    const all = SCAN.flatMap((d) => [...files(join(root, d))]);
    expect(all.length).toBeGreaterThan(15);
  });
  it('no rent literal in app / codec / crank source', () => {
    const hits: string[] = [];
    for (const d of SCAN)
      for (const f of files(join(root, d)))
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RENT_LITERAL.test(line)) hits.push(`${f.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
          });
    expect(hits, hits.join('\n')).toEqual([]);
  });
});
