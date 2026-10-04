import { PublicKey } from '@solana/web3.js';
import { DISC, ORE_PROGRAM_ID, SIZE } from './constants';
import { LayoutMismatch } from './errors';

/** Minimal account shape: what getAccountInfo / getMultipleAccounts give us. */
export interface RawAccount {
  owner: PublicKey;
  data: Uint8Array;
}

class Reader {
  private o = 8; // skip 8-byte steel discriminator
  private v: DataView;
  constructor(private d: Uint8Array) {
    this.v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  u64(): bigint {
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  }
  u16(): number {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  pk(): PublicKey {
    const x = new PublicKey(this.d.slice(this.o, this.o + 32));
    this.o += 32;
    return x;
  }
  u64s(n: number): bigint[] {
    return Array.from({ length: n }, () => this.u64());
  }
  /** steel `Numeric` (I80F48): 16 bytes, signed little-endian. Kept raw. */
  numeric(): bigint {
    const lo = this.v.getBigUint64(this.o, true);
    const hi = this.v.getBigInt64(this.o + 8, true);
    this.o += 16;
    return (hi << 64n) | lo;
  }
  bytes(n: number): Uint8Array {
    const x = this.d.slice(this.o, this.o + n);
    this.o += n;
    return x;
  }
}

function check(name: keyof typeof SIZE, a: RawAccount): Reader {
  if (!a.owner.equals(ORE_PROGRAM_ID)) throw new LayoutMismatch(name, 'owner', `owned by ${a.owner.toBase58()}`);
  if (a.data.length !== SIZE[name]) throw new LayoutMismatch(name, 'size', `${a.data.length} != ${SIZE[name]}`);
  const disc = a.data.subarray(0, 8);
  if (disc[0] !== DISC[name] || disc.subarray(1).some((b) => b !== 0))
    throw new LayoutMismatch(name, 'discriminator', `[${Array.from(disc).join(',')}]`);
  return new Reader(a.data);
}

// Field order = struct order in api/src/state/*.rs (all #[repr(C)] Pod, little-endian). See ORE_NOTES.md §5.

export interface Automation {
  amount: bigint;
  authority: PublicKey;
  balance: bigint;
  executor: PublicKey;
  fee: bigint;
  strategy: bigint;
  mask: bigint;
  reload: bigint;
  totalSolSpent: bigint;
  totalOreEarned: bigint;
  conditions: {
    maxProductionCost: bigint;
    minMotherlode: number;
    maxMotherlode: number;
    splitTiles: number;
    soloTiles: number;
    buffer: bigint;
  };
}

export interface Miner {
  authority: PublicKey;
  autoReturn: bigint;
  checkpointId: bigint;
  checkpointFee: bigint;
  deployed: bigint[];
  mass: bigint[];
  cumulative: bigint[];
  roundId: bigint;
  rewardsFactor: bigint;
  /** SOL held in the Miner account, claimable via ClaimSOL (stays 0 while auto_return>0 — see ORE_NOTES §7). */
  rewardsSol: bigint;
  /** "refined" ORE (earned from refining fees). Claiming it carries no fee. */
  refinedOre: bigint;
  /** "unrefined" ORE (mined). Claiming it takes a 10% fee. */
  rewardsOre: bigint;
  lastClaimOreAt: bigint;
  lastClaimSolAt: bigint;
  lifetimeRewardsOre: bigint;
  lifetimeDeployed: bigint;
  lifetimeRewardsSol: bigint;
}

export interface Board {
  roundId: bigint;
  startSlot: bigint;
  endSlot: bigint;
  productionCostEma: bigint;
}

export interface Round {
  id: bigint;
  deployed: bigint[];
  mass: bigint[];
  count: bigint[];
  slotHash: Uint8Array;
  expiresAt: bigint;
  motherlode: bigint;
  rentPayer: PublicKey;
  rewards: bigint[];
  totalVaulted: bigint;
  totalReturnedSol: bigint;
  totalMiners: bigint;
  topMiner: PublicKey;
}

export interface Treasury {
  motherlode: bigint;
  minerRewardsFactor: bigint;
  totalRefined: bigint;
  totalUnclaimed: bigint;
}

export interface Config {
  admin: { authority: PublicKey; feeCollector: PublicKey; feeRate: bigint };
  protocol: {
    authority: PublicKey;
    feeCollector: PublicKey;
    feeRate: bigint;
    intermissionSlots: bigint;
    roundSlots: bigint;
    entropyVarAddress: PublicKey;
    entropyProgramId: PublicKey;
  };
}

export const decode = {
  automation(a: RawAccount): Automation {
    const r = check('automation', a);
    return {
      amount: r.u64(),
      authority: r.pk(),
      balance: r.u64(),
      executor: r.pk(),
      fee: r.u64(),
      strategy: r.u64(),
      mask: r.u64(),
      reload: r.u64(),
      totalSolSpent: r.u64(),
      totalOreEarned: r.u64(),
      conditions: {
        maxProductionCost: r.u64(),
        minMotherlode: r.u16(),
        maxMotherlode: r.u16(),
        splitTiles: r.u16(),
        soloTiles: r.u16(),
        buffer: r.u64(),
      },
    };
  },
  miner(a: RawAccount): Miner {
    const r = check('miner', a);
    return {
      authority: r.pk(),
      autoReturn: r.u64(),
      checkpointId: r.u64(),
      checkpointFee: r.u64(),
      deployed: r.u64s(25),
      mass: r.u64s(25),
      cumulative: r.u64s(25),
      roundId: r.u64(),
      rewardsFactor: r.numeric(),
      rewardsSol: r.u64(),
      refinedOre: r.u64(),
      rewardsOre: r.u64(),
      lastClaimOreAt: r.u64(),
      lastClaimSolAt: r.u64(),
      lifetimeRewardsOre: r.u64(),
      lifetimeDeployed: r.u64(),
      lifetimeRewardsSol: r.u64(),
    };
  },
  board(a: RawAccount): Board {
    const r = check('board', a);
    return { roundId: r.u64(), startSlot: r.u64(), endSlot: r.u64(), productionCostEma: r.u64() };
  },
  round(a: RawAccount): Round {
    const r = check('round', a);
    return {
      id: r.u64(),
      deployed: r.u64s(25),
      mass: r.u64s(25),
      count: r.u64s(25),
      slotHash: r.bytes(32),
      expiresAt: r.u64(),
      motherlode: r.u64(),
      rentPayer: r.pk(),
      rewards: r.u64s(25),
      totalVaulted: r.u64(),
      totalReturnedSol: r.u64(),
      totalMiners: r.u64(),
      topMiner: r.pk(),
    };
  },
  treasury(a: RawAccount): Treasury {
    const r = check('treasury', a);
    return { motherlode: r.u64(), minerRewardsFactor: r.numeric(), totalRefined: r.u64(), totalUnclaimed: r.u64() };
  },
  config(a: RawAccount): Config {
    const r = check('config', a);
    return {
      admin: { authority: r.pk(), feeCollector: r.pk(), feeRate: r.u64() },
      protocol: {
        authority: r.pk(),
        feeCollector: r.pk(),
        feeRate: r.u64(),
        intermissionSlots: r.u64(),
        roundSlots: r.u64(),
        entropyVarAddress: r.pk(),
        entropyProgramId: r.pk(),
      },
    };
  },
};
