#!/usr/bin/env node
/**
 * Scans the WHOLE git history (every commit, every file) for things that must never be pushed: Solana secret keys (JSON byte arrays /
 * base58 next to "secret"-style words), PEM private keys, EXECUTOR_KEYPAIR assignments with a value, API keys in URLs, and key files
 * that were ever tracked. Run before pushing the repo (NFR-S5, PRD §11).
 *
 *   node scripts/secret-scan.mjs
 *
 * Exit 0 = clean, 1 = findings. It prints commit, file and line, with the matched text MASKED, so the scan never echoes a secret.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const B58 = '[1-9A-HJ-NP-Za-km-z]';
export const RULES = [
  { id: 'solana-secret-json', re: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/ },
  { id: 'pem-private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'keypair-env-assignment', re: /EXECUTOR_KEYPAIR\s*[=:]\s*['"]?(?:\[\s*\d|[1-9A-HJ-NP-Za-km-z]{40,})/ },
  { id: 'base58-secret-near-keyword', re: new RegExp(`(?:secret|private|keypair|seed)[^\\n]{0,40}${B58}{86,90}`, 'i') },
  { id: 'api-key-in-url', re: /api[-_]?key=[A-Za-z0-9_-]{16,}/i },
];
const KEY_FILE = /(^|\/)(executor|id)\.json$|(^|\/)[^/]*keypair[^/]*\.json$|(^|\/)\.env(\.[^/]*)?$|\.(pem|key|keystore|jks)$/i;
const ALLOWED_FILE = /(^|\/)\.env\.example$/;
/**
 * Files whose CONTENT is not scanned: the scanner and its test legitimately contain synthetic sample secrets (fake keys used to prove
 * the rules fire). Exactly these two paths; the key-file NAME check still applies to every path.
 */
export const CONTENT_ALLOWLIST = new Set(['scripts/secret-scan.mjs', 'scripts/secret-scan.test.ts']);

export function mask(s) {
  return `${s.slice(0, 4)}…[${s.length} chars masked]`;
}

/** Findings in one text blob. Pure: used by the unit test with synthetic samples. */
export function findInText(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (m) out.push({ rule: r.id, line: i + 1, masked: mask(m[0]) });
    }
  });
  return out;
}

export function isKeyFile(path) {
  return KEY_FILE.test(path) && !ALLOWED_FILE.test(path);
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

function main() {
  const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
  const findings = [];
  const seenBlob = new Set();
  for (const c of commits) {
    const files = git(['ls-tree', '-r', '--full-name', c]).split('\n').filter(Boolean);
    for (const row of files) {
      const [meta, path] = row.split('\t');
      const blob = meta.split(' ')[2];
      if (isKeyFile(path)) findings.push({ commit: c.slice(0, 8), path, rule: 'key-file-tracked', line: 0, masked: '(file name)' });
      if (CONTENT_ALLOWLIST.has(path)) continue;
      if (seenBlob.has(blob)) continue; // identical content already scanned
      seenBlob.add(blob);
      if (/\.(png|jpg|jpeg|gif|ico|ttf|otf|woff2?|hbc|apk|lock)$/i.test(path) || path.endsWith('package-lock.json')) continue;
      let text;
      try {
        text = git(['cat-file', 'blob', blob]);
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue; // binary
      for (const f of findInText(text)) findings.push({ commit: c.slice(0, 8), path, ...f });
    }
  }
  console.log(`scanned ${commits.length} commit(s), ${seenBlob.size} distinct file version(s)`);
  if (findings.length === 0) {
    console.log('CLEAN: no secret patterns found in the history.');
    return 0;
  }
  console.log(`FOUND ${findings.length} potential secret(s):`);
  for (const f of findings) console.log(`  [${f.rule}] ${f.path}:${f.line}  (commit ${f.commit})  ${f.masked}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
