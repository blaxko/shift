import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  ENTROPY_PROGRAM_ID,
  ENTROPY_VAR_ADDRESS,
  InvariantViolation,
  MAX_DEPOSIT_LAMPORTS,
  MEMO_PROGRAM_ID,
  ORE_MINT,
  ORE_PROGRAM_ID,
  PERMISSIONLESS_EXECUTOR,
  TOKEN_PROGRAM_ID,
  TREASURY_ADDRESS,
  associatedTokenAddress,
  automate,
  checkpoint,
  claimOre,
  claimSol,
  executorDeploy,
  pdas,
  shiftMemo,
  stopAutomation,
} from '../src';

const user = new PublicKey('3sTPtk6VT6hvoJmzVyB8Mqd6gzgVzxr1taMZ7RNtVJsC'); // a real authority from a fixture
const crank = new PublicKey('HNWhK5f8RMWBqcA7mXJPaxdTPGrha3rrqUrri7HSKb3T'); // any distinct key for builder tests
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const meta = (ix: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) =>
  ix.keys.map((k) => `${k.pubkey.toBase58()}${k.isSigner ? ':s' : ''}${k.isWritable ? ':w' : ''}`);

const baseAutomate = { authority: user, executor: crank, amount: 1000n, deposit: 50_000_000n, fee: 1000n, mask: 31n, reload: false as const };

describe('automate (F3, AC-3.1): byte layout vs ORE_NOTES §3 (AutomateV2, 66 bytes)', () => {
  // Hand-computed from the layout: disc | amount | deposit | fee | mask | strategy | reload | conditions
  const GOLDEN =
    '00' +
    'e803000000000000' + // amount 1000
    '80f0fa0200000000' + // deposit 50_000_000
    'e803000000000000' + // fee 1000
    '1f00000000000000' + // mask 0b11111
    '01' + // strategy Preferred
    '0000000000000000' + // reload 0
    'ffffffffffffffff' + // max_production_cost
    '0000' + // min_motherlode
    'ffff' + // max_motherlode
    '0000' + // split_tiles
    '0000' + // solo_tiles
    '0000000000000000'; // _buffer

  it('data equals the golden vector, 66 bytes', () => {
    const ix = automate(baseAutomate);
    expect(hex(ix.data)).toBe(GOLDEN);
    expect(ix.data.length).toBe(66);
  });

  it('account order and flags: [signer(w,s), automation(w), executor(w), miner(w), system]', () => {
    expect(meta(automate(baseAutomate))).toEqual([
      `${user.toBase58()}:s:w`,
      `${pdas.automation(user).toBase58()}:w`,
      `${crank.toBase58()}:w`,
      `${pdas.miner(user).toBase58()}:w`,
      '11111111111111111111111111111111',
    ]);
    expect(automate(baseAutomate).programId.equals(ORE_PROGRAM_ID)).toBe(true);
  });

  it('encodes large u64 values little-endian', () => {
    const ix = automate({ ...baseAutomate, fee: 0x0102030405060708n });
    expect(hex(ix.data.subarray(17, 25))).toBe('0807060504030201');
  });
});

describe('NFR-S3 / NFR-S4 invariants (unit-tested, AC-3.x)', () => {
  it('NFR-S3: rejects deposit > 0.5 SOL, accepts exactly 0.5 SOL', () => {
    expect(() => automate({ ...baseAutomate, deposit: MAX_DEPOSIT_LAMPORTS + 1n })).toThrowError(InvariantViolation);
    expect(() => automate({ ...baseAutomate, deposit: MAX_DEPOSIT_LAMPORTS })).not.toThrow();
    expect(MAX_DEPOSIT_LAMPORTS).toBe(500_000_000n);
  });
  it('NFR-S3: rejects zero deposit', () => {
    expect(() => automate({ ...baseAutomate, deposit: 0n })).toThrowError(/NFR-S3/);
  });
  it('NFR-S4: reload is always 0 on the wire, and anything but `false` throws', () => {
    expect(hex(automate(baseAutomate).data.subarray(34, 42))).toBe('0000000000000000'); // reload u64
    expect(() => automate({ ...baseAutomate, reload: true as unknown as false })).toThrowError(/NFR-S4/);
    expect(() => automate({ ...baseAutomate, reload: 1 as unknown as false })).toThrowError(/NFR-S4/);
  });
  it('strategy byte is always Preferred (1): the executor can never choose squares', () => {
    expect(automate(baseAutomate).data[33]).toBe(1);
  });
  it('rejects executors that would defeat the model', () => {
    expect(() => automate({ ...baseAutomate, executor: PublicKey.default })).toThrowError(InvariantViolation);
    expect(() => automate({ ...baseAutomate, executor: PERMISSIONLESS_EXECUTOR })).toThrowError(InvariantViolation);
    expect(() => automate({ ...baseAutomate, executor: user })).toThrowError(InvariantViolation);
  });
  it('rejects empty / out-of-range masks and zero amount', () => {
    expect(() => automate({ ...baseAutomate, mask: 0n })).toThrowError(InvariantViolation);
    expect(() => automate({ ...baseAutomate, mask: 1n << 25n })).toThrowError(InvariantViolation);
    expect(() => automate({ ...baseAutomate, amount: 0n })).toThrowError(InvariantViolation);
  });
});

describe('stopAutomation (F7, Q-4): Automate with executor = default pubkey (automate.rs:87-97)', () => {
  const ix = stopAutomation(user);
  it('same 66-byte layout, all numeric fields zero, conditions default', () => {
    expect(ix.data.length).toBe(66);
    expect(hex(ix.data)).toBe('00' + '00'.repeat(8 * 4) + '00' + '00'.repeat(8) + 'ffffffffffffffff0000ffff000000000000000000000000');
  });
  it('executor account is the default pubkey', () => {
    expect(ix.keys[2]!.pubkey.equals(PublicKey.default)).toBe(true);
    expect(ix.keys[0]!.pubkey.equals(user) && ix.keys[0]!.isSigner).toBe(true);
    expect(ix.keys[1]!.pubkey.equals(pdas.automation(user))).toBe(true);
  });
});

describe('executorDeploy (F4): accounts per deploy.rs:17-21 + entropy', () => {
  const ix = executorDeploy({ executor: crank, authority: user, roundId: 428270n, amount: 1000n, mask: 31n });
  it('12 accounts in program order with correct flags', () => {
    expect(meta(ix)).toEqual([
      `${crank.toBase58()}:s:w`,
      `${user.toBase58()}:w`,
      `${pdas.automation(user).toBase58()}:w`,
      `${BOARD_ADDRESS.toBase58()}:w`,
      `${CONFIG_ADDRESS.toBase58()}:w`,
      `${pdas.miner(user).toBase58()}:w`,
      `${pdas.round(428270n).toBase58()}:w`,
      `${TREASURY_ADDRESS.toBase58()}:w`,
      '11111111111111111111111111111111',
      ORE_PROGRAM_ID.toBase58(),
      `${ENTROPY_VAR_ADDRESS.toBase58()}:w`,
      ENTROPY_PROGRAM_ID.toBase58(),
    ]);
  });
  it('data = disc 6 | amount u64 | squares u32 (13 bytes)', () => {
    expect(hex(ix.data)).toBe('06' + 'e803000000000000' + '1f000000');
    expect(ix.data.length).toBe(13);
  });
  it('entropy var constant == var_pda(board, 0) under the entropy program (entropy-api state/mod.rs:16-21)', () => {
    const derived = PublicKey.findProgramAddressSync([Buffer.from('var'), BOARD_ADDRESS.toBuffer(), Buffer.alloc(8)], ENTROPY_PROGRAM_ID)[0];
    expect(derived.equals(ENTROPY_VAR_ADDRESS)).toBe(true);
  });
  it('the live Config fixture holds different (stale) entropy values — the codec must not use them', () => {
    const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'config-9c9X7aDR.json'), 'utf8')) as { dataBase64: string };
    const b = Buffer.from(fx.dataBase64, 'base64');
    expect(new PublicKey(b.subarray(168, 200)).equals(ENTROPY_VAR_ADDRESS)).toBe(false);
  });
});

describe('checkpoint: accounts per checkpoint.rs:10', () => {
  const signer = crank;
  const ix = checkpoint({ signer, authority: user, roundId: 428269n });
  it('8 accounts, 1-byte data (disc 2)', () => {
    expect(meta(ix)).toEqual([
      `${signer.toBase58()}:s:w`,
      `${user.toBase58()}:w`,
      `${pdas.automation(user).toBase58()}:w`,
      `${BOARD_ADDRESS.toBase58()}:w`,
      `${pdas.miner(user).toBase58()}:w`,
      `${pdas.round(428269n).toBase58()}:w`,
      `${TREASURY_ADDRESS.toBase58()}:w`,
      '11111111111111111111111111111111',
    ]);
    expect(hex(ix.data)).toBe('02');
  });
});

describe('claimSol / claimOre (F7)', () => {
  it('claimSol: 5 accounts per claim_sol.rs:10, data disc 3', () => {
    const ix = claimSol(user);
    expect(meta(ix)).toEqual([
      `${user.toBase58()}:s:w`,
      `${BOARD_ADDRESS.toBase58()}:w`,
      `${pdas.miner(user).toBase58()}:w`,
      '11111111111111111111111111111111',
      ORE_PROGRAM_ID.toBase58(),
    ]);
    expect(hex(ix.data)).toBe('03');
  });
  it('claimOre: 11 accounts per claim_ore.rs:61, data disc 4 + bps 10000 LE', () => {
    const ix = claimOre(user);
    const userAta = associatedTokenAddress(user, ORE_MINT);
    const treasuryAta = associatedTokenAddress(TREASURY_ADDRESS, ORE_MINT);
    expect(meta(ix)).toEqual([
      `${user.toBase58()}:s:w`,
      `${BOARD_ADDRESS.toBase58()}:w`,
      `${pdas.miner(user).toBase58()}:w`,
      `${ORE_MINT.toBase58()}:w`,
      `${userAta.toBase58()}:w`,
      `${TREASURY_ADDRESS.toBase58()}:w`,
      `${treasuryAta.toBase58()}:w`,
      '11111111111111111111111111111111',
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
      ORE_PROGRAM_ID.toBase58(),
    ]);
    expect(hex(ix.data)).toBe('04' + '1027000000000000');
  });
  it('claimOre rejects bps out of range', () => {
    expect(() => claimOre(user, 0n)).toThrow();
    expect(() => claimOre(user, 10_001n)).toThrow();
  });
  it('ATA derivation matches a known on-chain ORE token account (treasury ATA from the Treasury PDA)', () => {
    // The treasury's ORE ATA is a real mainnet account; recompute it from the PDA and the standard ATA seeds.
    const expected = PublicKey.findProgramAddressSync(
      [TREASURY_ADDRESS.toBytes(), TOKEN_PROGRAM_ID.toBytes(), ORE_MINT.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
    expect(associatedTokenAddress(TREASURY_ADDRESS, ORE_MINT).equals(expected)).toBe(true);
  });
});

describe('shiftMemo', () => {
  it('Memo v2 program, user is the only (signer) key, UTF-8 data', () => {
    const k = Keypair.generate().publicKey;
    const ix = shiftMemo(k, 'SHIFT1|OUT|abcdefghijkmnopq');
    expect(ix.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(ix.keys).toEqual([{ pubkey: k, isSigner: true, isWritable: false }]);
    expect(ix.data.toString('utf8')).toBe('SHIFT1|OUT|abcdefghijkmnopq');
  });
  it('rejects empty and > 200 byte memos', () => {
    const k = Keypair.generate().publicKey;
    expect(() => shiftMemo(k, '')).toThrow();
    expect(() => shiftMemo(k, 'x'.repeat(201))).toThrow();
    expect(() => shiftMemo(k, 'x'.repeat(200))).not.toThrow();
  });
});
