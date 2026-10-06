// F7 UI. ONE panel, ONE flow for both "End shift & withdraw" (shift still running) and "Clock out & collect" (shift complete):
// AC-7.1 (a single transaction), AC-7.3 (confirmation before anything is signed, stating what comes back).
import React, { useEffect, useRef, useState } from 'react';
import { formatSol } from '../domain/format';
import { IN_SIG_PREFIX_LENGTH, type Payslip } from '../domain/shift';
import { useFlow } from '../services/useFlow';
import { Banner, Btn, Card, H2, P } from './ui';

export function ClockOutPanel({ p, onPaying, onFinished }: { p: Payslip; /** tells the screen a clock-out is in flight (state: Paying) */ onPaying: (inSigPrefix: string | undefined) => void; onFinished: () => void }) {
  const flow = useFlow();
  const [confirming, setConfirming] = useState(false);
  const done = useRef(false);
  const live = p.status !== 'complete'; // active, paused or paying: the shift is still running (or being ended)
  const nothingToCollect = !live && p.roundsWorked === 0;

  useEffect(() => {
    if (!flow.outcome) return;
    onPaying(undefined);
    if (flow.outcome.kind === 'success' && !done.current) {
      done.current = true;
      setConfirming(false);
    }
    onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.outcome]);

  const run = async () => {
    onPaying(p.shiftId.slice(0, IN_SIG_PREFIX_LENGTH));
    await flow.clockOut(p.shiftId);
  };

  const busy = flow.status !== null;
  const o = flow.outcome;
  if (o?.kind === 'success') {
    return <Banner tone="info">{live ? 'Your shift was ended and your rewards collected.' : 'Done. This shift is marked PAID.'}</Banner>;
  }

  return (
    <Card>
      <H2>{live ? 'End shift early' : 'Clock out & collect'}</H2>
      {!confirming ? (
        <Btn kind={live ? 'secondary' : 'primary'} title={live ? 'End shift & withdraw' : 'Clock out & collect'} onPress={() => setConfirming(true)} />
      ) : (
        <>
          {live ? (
            <P>
              This ends your shift and collects your rewards in ONE transaction. About <P style={{ fontWeight: '800' }}>{formatSol(p.balanceLeftLamports ?? 0n, 4)} SOL</P> of unspent budget comes back to your wallet, plus the
              account deposit, and any ORE you have earned is paid out (ORE keeps a 10 % fee on mined ORE).
            </P>
          ) : nothingToCollect ? (
            <P>No rounds were played, so there is nothing to collect. This just records the shift as PAID (a small network fee applies).</P>
          ) : (
            <P>
              This settles your last round if needed, pays out any ORE you have earned (ORE keeps a 10 % fee on mined ORE) and marks this shift PAID, all in ONE transaction. If you do not have an ORE token account yet, ORE creates one for you
              (a small one-time deposit).
            </P>
          )}
          <Btn
            title={live ? 'Confirm: end shift' : 'Confirm: clock out'}
            busy={busy}
            disabled={busy}
            onPress={() => void run()}
            accessibilityHint="Opens your wallet to approve one transaction"
          />
          <Btn kind="secondary" title="Not now" disabled={busy} onPress={() => setConfirming(false)} />
        </>
      )}
      {flow.status && <Banner tone="info">{flow.status === 'awaiting-wallet' ? 'Approve in your wallet…' : flow.status === 'confirming' ? 'Confirming on the network…' : flow.status === 'reconciling' ? 'Making sure it went through…' : 'Working…'}</Banner>}
      {flow.error && <Banner tone="error">A safety check stopped this before anything was sent to your wallet.</Banner>}
      {o?.kind === 'cancelled' && <Banner tone="info">Cancelled — nothing was sent.</Banner>}
      {(o?.kind === 'simulation-failed' || o?.kind === 'failed') && <Banner tone={o.kind === 'failed' && !o.retryable ? 'error' : 'warn'}>{o.error.userMessage}</Banner>}
      {o?.kind === 'blocked' && (
        <Banner tone="warn">
          {o.reason === 'already-paid' ? 'This shift was already clocked out.' : o.reason === 'maintenance' ? 'ORE was updated. SHIFT is in read-only maintenance mode until it is updated too.' : 'Could not check your shift right now. Try again.'}
        </Banner>
      )}
    </Card>
  );
}
