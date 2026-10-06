// F7 — the clock-out transaction: ONE transaction (AC-7.1): [Checkpoint if needed] -> [ClaimORE if > 0] -> [ClaimSOL if > 0]
// -> [close the automation if it is SHIFT's and still open] -> OUT memo. Parts with nothing to do are OMITTED rather than sent
// to fail (AC-7.4). "End shift & withdraw" on an active shift is this same transaction (AC-7.3). Pure.
import {
  InvariantViolation,
  MEMO_PROGRAM_ID,
  ORE_MINT,
  ORE_PROGRAM_ID,
  PERMISSIONLESS_EXECUTOR,
  associatedTokenAddress,
  checkpoint,
  claimOre,
  claimSol,
  formatOutMemo,
  parseMemo,
  pdas,
  shiftMemo,
  stopAutomation,
  type Automation,
  type Miner,
} from '@shift/codec';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { IN_SIG_PREFIX_LENGTH } from './shift';

export interface ClockOutPlan {
  /** Settle the Miner's last round first (miner.checkpointId != miner.roundId). */
  checkpointRoundId: bigint | null;
  claimOre: boolean;
  claimSol: boolean;
  /** Only ever SHIFT's own automation (executor == crank). A foreign automation is never touched (AC-3.5 spirit). */
  closeAutomation: boolean;
}

/**
 * `settled` is the Miner as it will be AFTER the checkpoint (the flow simulates the checkpoint to learn this, because rewards credited
 * by the checkpoint in the same transaction are not visible beforehand). Without a checkpoint it is just the current Miner.
 */
export function planClockOut(p: { miner: Miner | null; settled: Miner | null; automation: Automation | null; owner: PublicKey; crank: PublicKey | undefined }): ClockOutPlan {
  const { miner, settled, automation } = p;
  return {
    checkpointRoundId: miner && miner.checkpointId !== miner.roundId ? miner.roundId : null,
    claimOre: !!settled && settled.rewardsOre + settled.refinedOre > 0n,
    claimSol: !!settled && settled.rewardsSol > 0n,
    closeAutomation: !!(automation && p.crank && automation.executor.equals(p.crank) && automation.authority.equals(p.owner)),
  };
}

export interface ClockOutTx {
  instructions: TransactionInstruction[];
  memo: string;
}

export function buildClockOutInstructions(p: { owner: PublicKey; plan: ClockOutPlan; inSignature: string }): ClockOutTx {
  const memo = formatOutMemo({ inSigPrefix: p.inSignature.slice(0, IN_SIG_PREFIX_LENGTH) });
  const ixs: TransactionInstruction[] = [];
  if (p.plan.checkpointRoundId !== null) ixs.push(checkpoint({ signer: p.owner, authority: p.owner, roundId: p.plan.checkpointRoundId }));
  if (p.plan.claimOre) ixs.push(claimOre(p.owner)); // bps 10 000: everything (refined + unrefined, 10 % ORE fee on the unrefined part)
  if (p.plan.claimSol) ixs.push(claimSol(p.owner));
  if (p.plan.closeAutomation) ixs.push(stopAutomation(p.owner)); // ORE closes the account: balance + rent return to the wallet
  ixs.push(shiftMemo(p.owner, memo));
  return { instructions: ixs, memo };
}

const RANK = { checkpoint: 0, claimOre: 1, claimSol: 2, stop: 3, memo: 4 } as const;
type Kind = keyof typeof RANK;

/**
 * Defence in depth (NFR-S1/S2): decode the instructions about to be signed and refuse anything that is not exactly a clock-out for
 * the connected wallet. Funds can only come TO the wallet (claims and close are by the program's rules); nothing can send them away.
 */
export function assertClockOutInvariants(ixs: TransactionInstruction[], p: { owner: PublicKey; inSignature: string }): void {
  const { owner } = p;
  const bad = (rule: string, detail: string): never => {
    throw new InvariantViolation(rule, detail);
  };
  if (ixs.length < 1 || ixs.length > 5) bad('AC-7.1', `unexpected instruction count ${ixs.length}`);

  const miner = pdas.miner(owner);
  let last = -1;
  const seen = new Set<Kind>();
  ixs.forEach((ix, i) => {
    let kind: Kind;
    if (ix.programId.equals(MEMO_PROGRAM_ID)) {
      kind = 'memo';
      if (i !== ixs.length - 1) bad('AC-7.1', 'the OUT memo must be last');
      const m = parseMemo(ix.data.toString('utf8'));
      if (!m || m.kind !== 'OUT') bad('AC-7.1', 'memo is not a valid SHIFT OUT memo');
      else if (m.inSigPrefix !== p.inSignature.slice(0, IN_SIG_PREFIX_LENGTH)) bad('AC-7.1', 'OUT memo does not point at this shift');
      if (!ix.keys.every((k) => k.pubkey.equals(owner) && k.isSigner)) bad('NFR-S2', 'memo may only be signed by the wallet');
    } else if (ix.programId.equals(ORE_PROGRAM_ID)) {
      const d = ix.data[0];
      const k0 = ix.keys[0];
      if (!k0 || !k0.pubkey.equals(owner) || !k0.isSigner) bad('NFR-S1', 'every ORE instruction must be signed by the connected wallet');
      if (ix.keys.slice(1).some((k) => k.isSigner)) bad('NFR-S2', 'only the wallet may sign');
      if (d === 2) {
        kind = 'checkpoint';
        if (ix.data.length !== 1 || !ix.keys[1]!.pubkey.equals(owner) || !ix.keys[4]!.pubkey.equals(miner)) bad('NFR-S2', 'checkpoint must target the wallet\'s own miner');
      } else if (d === 4) {
        kind = 'claimOre';
        const bps = ix.data.length === 9 ? new DataView(ix.data.buffer, ix.data.byteOffset).getBigUint64(1, true) : -1n;
        if (bps !== 10_000n) bad('NFR-S2', 'ClaimORE must claim everything (bps 10000)');
        if (!ix.keys[2]!.pubkey.equals(miner) || !ix.keys[4]!.pubkey.equals(associatedTokenAddress(owner, ORE_MINT))) bad('NFR-S2', 'ClaimORE must pay the wallet\'s own ORE account');
      } else if (d === 3) {
        kind = 'claimSol';
        if (ix.data.length !== 1 || !ix.keys[2]!.pubkey.equals(miner)) bad('NFR-S2', 'ClaimSOL must target the wallet\'s own miner');
      } else if (d === 0) {
        kind = 'stop';
        const exec = ix.keys[2]?.pubkey;
        if (!exec || !exec.equals(PublicKey.default) || exec.equals(PERMISSIONLESS_EXECUTOR)) bad('NFR-S2', 'an Automate instruction here may only be a stop (default executor)');
        if (ix.data.length !== 66 || ix.data.subarray(1, 33).some((b) => b !== 0)) bad('NFR-S2', 'malformed stop instruction');
        if (!ix.keys[1]!.pubkey.equals(pdas.automation(owner)) || !ix.keys[3]!.pubkey.equals(miner)) bad('NFR-S2', 'stop must target the wallet\'s own automation');
      } else return bad('NFR-S2', `forbidden ORE instruction ${d}`);
    } else return bad('NFR-S2', `forbidden program ${ix.programId.toBase58()}`);

    if (RANK[kind] <= last) bad('AC-7.1', `instruction order / duplicate: ${kind}`);
    last = RANK[kind];
    seen.add(kind);
  });
  if (!seen.has('memo')) bad('AC-7.1', 'the OUT memo is required');
}
