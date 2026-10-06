#!/usr/bin/env node
/**
 * Generates the SHIFT executor (crank) keypair. YOU run this, on your machine; Claude never does (CLAUDE.md money-safety rules).
 *
 *   node scripts/gen-executor-key.mjs                       # normal use
 *   node scripts/gen-executor-key.mjs --print-secret-for-env # ALSO print the base58 secret (for a Railway env var). Off by default.
 *
 * - Writes the secret as a JSON byte array (Solana CLI format) to  <home>/shift-secrets/executor.json  (outside the repo).
 * - Creates the folder if needed. REFUSES to overwrite an existing file (flag "wx"): you can never lose a key by re-running.
 * - File mode 0600 (owner only; on Windows the home-folder ACL applies).
 * - Prints ONLY the public key and the file path. The secret is printed only with --print-secret-for-env.
 *
 * Fund the PUBLIC key with ~0.03 SOL for transaction fees (E-10: the crank reports low balance below 0.01 SOL). Never commit the file.
 */
import { Keypair } from '@solana/web3.js';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal base58 encoder (Bitcoin alphabet), so this script needs no extra dependency. Exported for the unit test. */
export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join('');
}

function main() {
  const printSecret = process.argv.includes('--print-secret-for-env');
  const unknown = process.argv.slice(2).filter((a) => a !== '--print-secret-for-env');
  if (unknown.length) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    process.exit(2);
  }

  const dir = join(homedir(), 'shift-secrets');
  const file = join(dir, 'executor.json');

  // Check BEFORE generating anything, so a refusal never creates (or shows) a key.
  if (existsSync(file)) {
    console.error(`Refusing to overwrite the existing key file:\n  ${file}\nMove or back it up yourself if you really want a new key.`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  const kp = Keypair.generate();
  try {
    // flag "wx": fail if the file appeared in the meantime (race) instead of overwriting.
    writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    console.error(`Could not write ${file}: ${e && e.code ? e.code : 'error'}. No key was saved.`);
    process.exit(1);
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort (no-op on some Windows filesystems) */
  }

  console.log('Executor public key (safe to share):');
  console.log(`  ${kp.publicKey.toBase58()}`);
  console.log('Secret key file (keep private, back it up, never commit it):');
  console.log(`  ${file}`);
  if (printSecret) {
    console.log('\nBase58 secret for a hosting env var (EXECUTOR_KEYPAIR). Treat it like a password; clear your terminal afterwards:');
    console.log(`  ${base58Encode(kp.secretKey)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
