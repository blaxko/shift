import { PublicKey } from '@solana/web3.js';

// Every value below traces to docs/ORE_NOTES.md (ore-api @ regolith-labs/ore 48c203bd, workspace v3.8.25).
// NFR-S7: program IDs are constants, checked against each decoded account's owner.

/** api/src/lib.rs:19 */
export const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
/** Memo v2 program (PRD §3 F3). */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** api/src/consts.rs: MINT_ADDRESS */
export const ORE_MINT = new PublicKey('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');
/** api/src/consts.rs: BOARD_ADDRESS / TREASURY_ADDRESS / CONFIG_ADDRESS (== the PDAs, asserted in tests) */
export const BOARD_ADDRESS = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');
export const TREASURY_ADDRESS = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
export const CONFIG_ADDRESS = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');
/** api/src/consts.rs: EXECUTOR_ADDRESS — "automation is permissionless" sentinel. */
export const PERMISSIONLESS_EXECUTOR = new PublicKey('executor11111111111111111111111111111111112');

/** api/src/state/mod.rs:333-342 (OreAccount enum; first byte of the 8-byte discriminator). */
export const DISC = { automation: 100, config: 101, miner: 103, treasury: 104, board: 105, round: 109 } as const;

/** Account sizes incl. 8-byte discriminator; confirmed against live mainnet fixtures (slot 453346683+). */
export const SIZE = { automation: 160, miner: 752, board: 40, round: 952, treasury: 48, config: 232 } as const;

/** api/src/consts.rs */
export const DENOMINATOR_BPS = 10_000n;
