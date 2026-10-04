import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  DISC,
  LayoutMismatch,
  ORE_PROGRAM_ID,
  SIZE,
  TREASURY_ADDRESS,
  decode,
  pdas,
} from '../src';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
interface Fx {
  kind: string;
  pubkey: string;
  owner: string;
  slot: number;
  fetchedAt: string;
  dataBase64: string;
}
const fixtures = (kind: string): Fx[] =>
  readdirSync(dir)
    .filter((f) => f.startsWith(`${kind}-`))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fx);
const raw = (f: Fx) => ({ owner: new PublicKey(f.owner), data: Buffer.from(f.dataBase64, 'base64') });

describe('fixtures are real, recorded mainnet dumps', () => {
  for (const kind of ['automation', 'miner', 'round', 'board', 'treasury', 'config']) {
    it(`${kind}: has slot + fetch date and ORE owner`, () => {
      const fx = fixtures(kind);
      expect(fx.length).toBeGreaterThanOrEqual(1);
      for (const f of fx) {
        expect(f.slot).toBeGreaterThan(0);
        expect(Date.parse(f.fetchedAt)).not.toBeNaN();
        expect(f.owner).toBe(ORE_PROGRAM_ID.toBase58());
      }
    });
  }
  it('has >= 3 live accounts of each of automation, miner, round (PRD §9.4 gate)', () => {
    for (const k of ['automation', 'miner', 'round']) expect(fixtures(k).length).toBeGreaterThanOrEqual(3);
  });
});

describe('decoders parse every fixture (E-11 checks pass on real data)', () => {
  it('automation', () => {
    for (const f of fixtures('automation')) {
      const a = decode.automation(raw(f));
      // The account lives at the PDA derived from its own authority (Q-6: one per authority).
      expect(pdas.automation(a.authority).toBase58()).toBe(f.pubkey);
      expect(a.conditions.maxProductionCost).toBe(0xffffffffffffffffn);
    }
  });
  it('miner', () => {
    for (const f of fixtures('miner')) {
      const m = decode.miner(raw(f));
      expect(pdas.miner(m.authority).toBase58()).toBe(f.pubkey);
      expect(m.deployed).toHaveLength(25);
      expect(m.autoReturn).toBe(1n);
    }
  });
  it('round', () => {
    for (const f of fixtures('round')) {
      const r = decode.round(raw(f));
      expect(pdas.round(r.id).toBase58()).toBe(f.pubkey);
    }
  });
  it('board / treasury / config singletons: PDA == hardcoded address, live round length', () => {
    const board = decode.board(raw(fixtures('board')[0]!));
    expect(board.endSlot - board.startSlot).toBe(240n);
    expect(pdas.board().equals(BOARD_ADDRESS)).toBe(true);
    expect(pdas.treasury().equals(TREASURY_ADDRESS)).toBe(true);
    expect(pdas.config().equals(CONFIG_ADDRESS)).toBe(true);
    expect(decode.treasury(raw(fixtures('treasury')[0]!)).motherlode).toBeGreaterThan(0n);
    const cfg = decode.config(raw(fixtures('config')[0]!));
    expect(cfg.protocol.roundSlots).toBe(240n);
    expect(cfg.protocol.intermissionSlots).toBe(48n);
  });
  it('board round id points at an existing round fixture id', () => {
    const board = decode.board(raw(fixtures('board')[0]!));
    const ids = fixtures('round').map((f) => decode.round(raw(f)).id);
    expect(ids).toContain(board.roundId);
  });
});

describe('E-11 LayoutMismatch', () => {
  const good = raw(fixtures('automation')[0]!);
  it('wrong owner', () => {
    expect(() => decode.automation({ ...good, owner: PublicKey.default })).toThrowError(LayoutMismatch);
    expect(() => decode.automation({ ...good, owner: PublicKey.default })).toThrowError(/owner/);
  });
  it('wrong size (e.g. program grew the struct)', () => {
    const grown = { ...good, data: Buffer.concat([good.data, Buffer.alloc(8)]) };
    expect(() => decode.automation(grown)).toThrowError(/size/);
  });
  it('wrong discriminator (a Miner passed as Automation)', () => {
    const d = Buffer.from(good.data);
    d[0] = DISC.miner;
    expect(() => decode.automation({ ...good, data: d })).toThrowError(/discriminator/);
  });
  it('sizes constant matches fixture lengths', () => {
    expect(good.data.length).toBe(SIZE.automation);
    expect(raw(fixtures('miner')[0]!).data.length).toBe(SIZE.miner);
    expect(raw(fixtures('round')[0]!).data.length).toBe(SIZE.round);
  });
});
