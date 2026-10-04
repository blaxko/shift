import { PublicKey } from '@solana/web3.js';
import { ORE_PROGRAM_ID } from './constants';

// Seeds: api/src/state/mod.rs:344-370 (+ consts.rs seed constants).
const enc = (s: string) => new TextEncoder().encode(s);
const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

export const pdas = {
  /** [b"automation", authority] — one automation per authority (answers Q-6). */
  automation: (authority: PublicKey) =>
    PublicKey.findProgramAddressSync([enc('automation'), authority.toBytes()], ORE_PROGRAM_ID)[0],
  /** [b"miner", authority] */
  miner: (authority: PublicKey) => PublicKey.findProgramAddressSync([enc('miner'), authority.toBytes()], ORE_PROGRAM_ID)[0],
  /** [b"board"] */
  board: () => PublicKey.findProgramAddressSync([enc('board')], ORE_PROGRAM_ID)[0],
  /** [b"round", id as u64 LE] */
  round: (id: bigint) => PublicKey.findProgramAddressSync([enc('round'), u64le(id)], ORE_PROGRAM_ID)[0],
  /** [b"treasury"] */
  treasury: () => PublicKey.findProgramAddressSync([enc('treasury')], ORE_PROGRAM_ID)[0],
  /** [b"config"] */
  config: () => PublicKey.findProgramAddressSync([enc('config')], ORE_PROGRAM_ID)[0],
};
