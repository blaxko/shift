// FR-4.1 GET /health, E-10 (low balance), AC-11.1 inputs (roundStalled). The health STATE is in memory and only informational:
// the crank's behaviour never depends on it (AC-4.3 — a restart resumes within one round with no local state).
import { createServer, type Server } from 'node:http';
import type { Board } from '@shift/codec';
import type { PublicKey } from '@solana/web3.js';
import { U64_MAX } from './plan';

/** Same planning figure the app uses (measured 78.3 s, ORE_NOTES §7.6a). */
export const ROUND_SECONDS = 78;
/** PRD AC-11.1 / FR-4.1: stalled when the Board has not advanced for more than 3 rounds. */
export const STALLED_AFTER_SECONDS = 3 * ROUND_SECONDS;

export interface HealthSnapshot {
  ok: boolean;
  mode: 'LIVE' | 'DRY_RUN';
  crankPubkey: string;
  lastRoundId: string | null;
  lastRoundDeployedAt: number | null;
  activeAutomations: number;
  /** Slots since the current round's window closed without a Reset having started the next one (Reset lag). 0 if none. */
  slotLag: number;
  solBalance: number | null;
  solBalanceLamports: string | null;
  lowBalance: boolean;
  roundStalled: boolean;
  lastBoardAdvanceAt: number | null;
  currentRoundId: string | null;
}

export class HealthState {
  private lastTickAt: number | null = null;
  private failures = 0;
  private boardRound: bigint | null = null;
  private lastBoardAdvanceAt: number | null = null;
  private slotLag = 0;
  private lastRoundId: bigint | null = null;
  private lastDeployedAt: number | null = null;
  private active = 0;
  private balance: bigint | null = null;

  constructor(
    private executor: PublicKey,
    private live: boolean,
    private lowBalanceLamports: bigint,
    private pollMs: number,
  ) {}

  noteTick(nowUnix: number, ok: boolean) {
    this.lastTickAt = nowUnix;
    this.failures = ok ? 0 : this.failures + 1;
  }
  noteBoard(board: Board, slot: bigint, nowUnix: number) {
    if (this.boardRound === null || board.roundId !== this.boardRound) {
      this.boardRound = board.roundId;
      this.lastBoardAdvanceAt = nowUnix;
    }
    this.slotLag = board.endSlot !== U64_MAX && slot > board.endSlot ? Number(slot - board.endSlot) : 0;
  }
  noteDeploy(roundId: bigint, nowUnix: number) {
    this.lastRoundId = roundId;
    this.lastDeployedAt = nowUnix;
  }
  setActive(n: number) {
    this.active = n;
  }
  setBalance(l: bigint) {
    this.balance = l;
  }

  snapshot(nowUnix: number): HealthSnapshot {
    const fresh = this.lastTickAt !== null && nowUnix - this.lastTickAt <= Math.max(30, (this.pollMs * 5) / 1000);
    return {
      ok: fresh && this.failures < 3,
      mode: this.live ? 'LIVE' : 'DRY_RUN',
      crankPubkey: this.executor.toBase58(),
      lastRoundId: this.lastRoundId?.toString() ?? null,
      lastRoundDeployedAt: this.lastDeployedAt,
      activeAutomations: this.active,
      slotLag: this.slotLag,
      solBalance: this.balance === null ? null : Number(this.balance) / 1e9,
      solBalanceLamports: this.balance?.toString() ?? null,
      lowBalance: this.balance !== null && this.balance < this.lowBalanceLamports,
      roundStalled: this.lastBoardAdvanceAt !== null && nowUnix - this.lastBoardAdvanceAt > STALLED_AFTER_SECONDS,
      lastBoardAdvanceAt: this.lastBoardAdvanceAt,
      currentRoundId: this.boardRound?.toString() ?? null,
    };
  }
}

export function startHealthServer(health: HealthState, port: number, nowUnix: () => number = () => Math.floor(Date.now() / 1000)): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
      const body = JSON.stringify(health.snapshot(nowUnix()));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  server.listen(port);
  return server;
}
