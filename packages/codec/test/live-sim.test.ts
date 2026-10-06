import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Network test, off by default so `npm test` is deterministic and offline.
//   RUN_LIVE=1 [RPC_URL=...] npm test -- live-sim
// Read-only: simulateTransaction with sigVerify:false against mainnet. Proves the builders against the real ORE program,
// including PRD v1.1 FR-3.1 (idle shell: close + new Automate in ONE transaction).
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe.skipIf(!process.env.RUN_LIVE)('live simulation (read-only)', () => {
  it('builders pass simulateTransaction on mainnet', { timeout: 300_000 }, () => {
    const r = spawnSync('npx', ['tsx', 'scripts/simulate-live.ts'], { cwd: root, encoding: 'utf8', shell: true });
    const out = `${r.stdout}\n${r.stderr}`;
    const summary = out.slice(out.indexOf('SUMMARY'));
    expect(summary, out).toContain('PASS  A idle-shell close+Automate in ONE tx');
    expect(summary, out).toContain('PASS  B fresh clock-in');
    // Drift guard: what ORE actually charges for new accounts must equal the RPC's current rent-exempt minimum.
    expect(summary, out).toContain('PASS  B rent charged == live getMinimumBalanceForRentExemption (automation)');
    expect(summary, out).toContain('PASS  B rent charged == live minimum + 10000 reserve (miner)');
    expect(summary).not.toContain('FAIL');
  });
});
