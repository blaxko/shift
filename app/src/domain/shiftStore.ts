// Local cache (PRD §9.2). It is a CACHE: deleting it loses nothing that chain history cannot rebuild (AC-6.2, NFR-R1).
// Every row is keyed by wallet so switching wallets can never mix two ledgers (a gap in the PRD's schema, which had no wallet column).

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: (string | number | null)[]): Promise<void>;
  all<T>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
}

export interface StoredMemo {
  signature: string;
  blockTime: number;
  kind: 'IN' | 'OUT';
  /** The memo text exactly as on chain ("SHIFT1|..."). Re-parsed on read, so a parser fix applies to old rows. */
  raw: string;
}

export interface ShiftStore {
  getSetting(wallet: string, key: string): Promise<string | null>;
  setSetting(wallet: string, key: string, value: string): Promise<void>;
  upsertMemos(wallet: string, memos: StoredMemo[]): Promise<void>;
  memos(wallet: string): Promise<StoredMemo[]>;
  /** ORE delivered by a clock-out, parsed from that (immutable) transaction. */
  getClaim(wallet: string, outSignature: string): Promise<bigint | null>;
  setClaim(wallet: string, outSignature: string, oreReceived: bigint): Promise<void>;
  saveSnapshot(wallet: string, json: string, updatedAt: number): Promise<void>;
  loadSnapshot(wallet: string): Promise<{ json: string; updatedAt: number } | null>;
  clear(): Promise<void>;
}

export class SqlShiftStore implements ShiftStore {
  constructor(private db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (wallet TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (wallet, key));
      CREATE TABLE IF NOT EXISTS memos (wallet TEXT NOT NULL, signature TEXT NOT NULL, kind TEXT NOT NULL, raw TEXT NOT NULL, blockTime INTEGER NOT NULL, PRIMARY KEY (wallet, signature));
      CREATE TABLE IF NOT EXISTS claims (wallet TEXT NOT NULL, outSignature TEXT NOT NULL, ore TEXT NOT NULL, PRIMARY KEY (wallet, outSignature));
      CREATE TABLE IF NOT EXISTS snapshots (wallet TEXT NOT NULL PRIMARY KEY, json TEXT NOT NULL, updatedAt INTEGER NOT NULL);
    `);
  }

  async getSetting(wallet: string, key: string) {
    const r = await this.db.all<{ value: string }>('SELECT value FROM settings WHERE wallet = ? AND key = ?', [wallet, key]);
    return r[0]?.value ?? null;
  }
  async setSetting(wallet: string, key: string, value: string) {
    await this.db.run('INSERT OR REPLACE INTO settings (wallet, key, value) VALUES (?, ?, ?)', [wallet, key, value]);
  }
  async upsertMemos(wallet: string, memos: StoredMemo[]) {
    for (const m of memos) {
      await this.db.run('INSERT OR REPLACE INTO memos (wallet, signature, kind, raw, blockTime) VALUES (?, ?, ?, ?, ?)', [wallet, m.signature, m.kind, m.raw, m.blockTime]);
    }
  }
  async memos(wallet: string) {
    return this.db.all<StoredMemo>('SELECT signature, kind, raw, blockTime FROM memos WHERE wallet = ? ORDER BY blockTime ASC, signature ASC', [wallet]);
  }
  async getClaim(wallet: string, outSignature: string) {
    const r = await this.db.all<{ ore: string }>('SELECT ore FROM claims WHERE wallet = ? AND outSignature = ?', [wallet, outSignature]);
    return r[0] ? BigInt(r[0].ore) : null;
  }
  async setClaim(wallet: string, outSignature: string, ore: bigint) {
    await this.db.run('INSERT OR REPLACE INTO claims (wallet, outSignature, ore) VALUES (?, ?, ?)', [wallet, outSignature, ore.toString()]);
  }
  async saveSnapshot(wallet: string, json: string, updatedAt: number) {
    await this.db.run('INSERT OR REPLACE INTO snapshots (wallet, json, updatedAt) VALUES (?, ?, ?)', [wallet, json, updatedAt]);
  }
  async loadSnapshot(wallet: string) {
    const r = await this.db.all<{ json: string; updatedAt: number }>('SELECT json, updatedAt FROM snapshots WHERE wallet = ?', [wallet]);
    return r[0] ?? null;
  }
  async clear() {
    await this.db.exec('DELETE FROM settings; DELETE FROM memos; DELETE FROM claims; DELETE FROM snapshots;');
  }
}

/** Same contract in memory: used by unit tests of the refresh logic. */
export class MemoryShiftStore implements ShiftStore {
  settings = new Map<string, string>();
  private m = new Map<string, StoredMemo>();
  private c = new Map<string, bigint>();
  private s = new Map<string, { json: string; updatedAt: number }>();
  async getSetting(w: string, k: string) {
    return this.settings.get(`${w}|${k}`) ?? null;
  }
  async setSetting(w: string, k: string, v: string) {
    this.settings.set(`${w}|${k}`, v);
  }
  async upsertMemos(w: string, memos: StoredMemo[]) {
    for (const x of memos) this.m.set(`${w}|${x.signature}`, x);
  }
  async memos(w: string) {
    return [...this.m.entries()].filter(([k]) => k.startsWith(`${w}|`)).map(([, v]) => v).sort((a, b) => a.blockTime - b.blockTime || (a.signature < b.signature ? -1 : 1));
  }
  async getClaim(w: string, o: string) {
    return this.c.get(`${w}|${o}`) ?? null;
  }
  async setClaim(w: string, o: string, v: bigint) {
    this.c.set(`${w}|${o}`, v);
  }
  async saveSnapshot(w: string, json: string, updatedAt: number) {
    this.s.set(w, { json, updatedAt });
  }
  async loadSnapshot(w: string) {
    return this.s.get(w) ?? null;
  }
  async clear() {
    this.settings.clear();
    this.m.clear();
    this.c.clear();
    this.s.clear();
  }
}
