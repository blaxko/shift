// F6 wording. "Losses are shown first and in plain language" (PRD F6), NFR-A5 (never colour alone: sign + label), E-7 labels.
import { formatOre, formatSol, formatSolExact } from './format';
import type { Payslip } from './shift';

export interface PayslipText {
  /** First thing the user reads: what went in, what came back. */
  headline: string;
  net: { label: 'Net loss' | 'Net gain' | 'Break-even'; value: string };
  /** Present only when something needs explaining. */
  notes: string[];
}

const signed = (l: bigint) => `${l < 0n ? '−' : l > 0n ? '+' : ''}${formatSolExact(l < 0n ? -l : l)} SOL`;

export function describePayslip(p: Payslip): PayslipText {
  const put = `You put in ${formatSol(p.budgetLamports)} SOL.`;
  const live = p.status === 'active' || p.status === 'paused' || p.status === 'paying';
  let headline: string;
  if (live) {
    headline = `${put} So far ${formatSol(p.solDeployed)} SOL has been played and ORE has returned ${formatSol(p.solWon)} SOL.`;
  } else {
    const back = p.solWon + p.returnedAtClose; // returned during rounds + the unspent deposit ORE hands back on close
    const ore = p.oreEarned === null ? ' (ORE amount unavailable right now)' : p.oreEarned > 0n ? ` + ${formatOre(p.oreEarned)} ORE` : '';
    headline = `${put} You got back ${formatSol(back)} SOL${ore}.`;
  }

  const notes: string[] = [];
  if (p.claimedElsewhere) notes.push('Some rewards were claimed outside SHIFT.'); // AC-6.3
  if (p.oreEarlier > 0n) notes.push(`${formatOre(p.oreEarlier)} ORE of earlier rewards was already in your account before this shift. It is not counted as this shift's.`); // E-7
  if (p.unsettledRound) notes.push('The latest round has not been settled yet, so these figures can still grow.');
  if (p.setupCost > 0n) notes.push(`Includes one-time setup of ${formatSolExact(p.setupCost)} SOL that is not refundable.`);
  notes.push('Network fees are not included.');
  if (p.needsClockOut) notes.push("Clock out within 24 h to keep your final round's rewards."); // AC-6.5

  return {
    headline,
    net: { label: p.netSol < 0n ? 'Net loss' : p.netSol > 0n ? 'Net gain' : 'Break-even', value: signed(p.netSol) },
    notes,
  };
}

/** AC-6.5 wording, shared by Home, Payslip and (F8) the notification. */
export const CLOCK_OUT_NOTICE = "Clock out within 24 h to keep your final round's rewards";
