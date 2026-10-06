// FR-4.4: configuration comes from env vars only. NFR-S5: the key is read from env, never logged, never committed.
// Money-safety (CLAUDE.md rule 2): the crank is DRY-RUN BY DEFAULT. Live mode needs BOTH DRY_RUN=0 and the exact
// acknowledgement string below; any ambiguity is a hard startup error, never a silent fallback to live.
import { Keypair, PublicKey } from '@solana/web3.js';
import { base58Decode } from './base58';

export const LIVE_ACK = 'I-ACCEPT-MAINNET-TRANSACTIONS';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface CrankConfig {
  rpcUrl: string;
  /** Public key of the executor. All the crank needs to read chain state and to simulate. */
  executorPubkey: PublicKey;
  /** Present ONLY in live mode. In dry-run the secret is deliberately dropped after parsing. */
  keypair: Keypair | null;
  live: boolean;
  priorityFeeMicroLamports: number;
  port: number;
  pollMs: number;
  /** Warn (and report in /health) below this executor balance (E-10). */
  lowBalanceLamports: bigint;
  /** Stop sending this many slots before the round window closes (a tx that lands late just fails). */
  endMarginSlots: bigint;
  maxItemsPerTx: number;
}

/** Fat-finger cap: 2 000 000 micro-lamports/CU on a 200k CU tx is 0.0004 SOL. */
export const MAX_PRIORITY_FEE_MICROLAMPORTS = 2_000_000;

function parseSecret(raw: string): Keypair {
  const t = raw.trim();
  let bytes: Uint8Array;
  if (t.startsWith('[')) {
    const arr = JSON.parse(t) as unknown;
    if (!Array.isArray(arr) || arr.length !== 64 || arr.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('bad json');
    bytes = Uint8Array.from(arr as number[]);
  } else {
    bytes = base58Decode(t);
  }
  if (bytes.length !== 64) throw new Error('bad length');
  return Keypair.fromSecretKey(bytes);
}

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a non-negative integer`);
  const n = Number(raw);
  if (n < min || n > max) throw new ConfigError(`${name} must be between ${min} and ${max}`);
  return n;
}

export function parseConfig(env: NodeJS.ProcessEnv): CrankConfig {
  const rpcUrl = env.RPC_URL;
  if (!rpcUrl || !/^https?:\/\//.test(rpcUrl)) throw new ConfigError('RPC_URL is required (http/https URL)');

  // ---- dry-run / live lock
  const dry = env.DRY_RUN;
  let wantLive: boolean;
  if (dry === undefined || dry === '' || dry === '1' || dry === 'true') wantLive = false;
  else if (dry === '0' || dry === 'false') wantLive = true;
  else throw new ConfigError('DRY_RUN must be 1 or 0');
  if (wantLive && env.ACKNOWLEDGE_LIVE !== LIVE_ACK) {
    throw new ConfigError(`Refusing to start in LIVE mode: DRY_RUN=0 also requires ACKNOWLEDGE_LIVE=${LIVE_ACK}. (Live mode sends real mainnet transactions.)`);
  }

  // ---- executor identity
  let fromSecret: Keypair | null = null;
  if (env.EXECUTOR_KEYPAIR) {
    try {
      fromSecret = parseSecret(env.EXECUTOR_KEYPAIR);
    } catch {
      // Never echo the value or the parser's message (could contain fragments of the secret).
      throw new ConfigError('EXECUTOR_KEYPAIR is not a valid base58 or JSON-array secret key');
    }
  }
  let pub: PublicKey | null = null;
  if (env.EXECUTOR_PUBKEY) {
    try {
      pub = new PublicKey(env.EXECUTOR_PUBKEY);
    } catch {
      throw new ConfigError('EXECUTOR_PUBKEY is not a valid public key');
    }
  }
  if (fromSecret && pub && !fromSecret.publicKey.equals(pub)) throw new ConfigError('EXECUTOR_PUBKEY does not match EXECUTOR_KEYPAIR');
  const executorPubkey = pub ?? fromSecret?.publicKey;
  if (!executorPubkey) throw new ConfigError('Set EXECUTOR_PUBKEY (dry-run) or EXECUTOR_KEYPAIR (live)');
  if (wantLive && !fromSecret) throw new ConfigError('Live mode requires EXECUTOR_KEYPAIR');

  return {
    rpcUrl,
    executorPubkey,
    keypair: wantLive ? fromSecret : null, // dry-run never holds the secret
    live: wantLive,
    priorityFeeMicroLamports: int(env, 'PRIORITY_FEE_MICROLAMPORTS', 1000, 0, MAX_PRIORITY_FEE_MICROLAMPORTS),
    port: int(env, 'PORT', 8080, 1, 65535),
    pollMs: int(env, 'POLL_MS', 2000, 250, 60_000),
    lowBalanceLamports: 50_000_000n, // E-10: alert below 0.05 SOL
    endMarginSlots: BigInt(int(env, 'END_MARGIN_SLOTS', 8, 0, 100)),
    maxItemsPerTx: int(env, 'MAX_ITEMS_PER_TX', 5, 1, 12),
  };
}

/** Safe to log: public information only. */
export function describeConfig(c: CrankConfig): Record<string, unknown> {
  return {
    mode: c.live ? 'LIVE' : 'DRY_RUN',
    rpc: new URL(c.rpcUrl).origin, // never the path/query: that is where API keys live
    executor: c.executorPubkey.toBase58(),
    priorityFeeMicroLamports: c.priorityFeeMicroLamports,
    port: c.port,
    pollMs: c.pollMs,
    endMarginSlots: Number(c.endMarginSlots),
    maxItemsPerTx: c.maxItemsPerTx,
  };
}
