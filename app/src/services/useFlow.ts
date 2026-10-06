// React wrapper around the guarded flows: one run at a time (re-entrancy guard), live status for the UI.
import { useCallback, useRef, useState } from 'react';
import { CRANK_PUBKEY } from '../config/constants';
import { runClockIn, runEndShift, type ClockInInput, type ClockInOutcome, type FlowStatus } from '../domain/clockInFlow';
import { makeFlowDeps } from './txDeps';
import { useShiftWallet } from './wallet';

export type FlowOutcome = Awaited<ReturnType<typeof runEndShift>>;

export function useFlow() {
  const { address, connection, signAndSend } = useShiftWallet();
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false); // a second tap while a run is in flight is ignored: never two submissions

  const guarded = useCallback(
    async (fn: () => Promise<FlowOutcome>) => {
      if (running.current) return;
      running.current = true;
      setOutcome(null);
      setError(null);
      try {
        setOutcome(await fn());
      } catch (e) {
        // An InvariantViolation (a bug or tampering) lands here BEFORE anything was sent to the wallet.
        setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      } finally {
        running.current = false;
        setStatus(null);
      }
    },
    [],
  );

  const clockIn = useCallback(
    (plan: ClockInInput['plan']) =>
      guarded(async (): Promise<ClockInOutcome> => {
        if (!address || !CRANK_PUBKEY) throw new Error('wallet or executor key not configured');
        const now = new Date();
        const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return runClockIn({ owner: address, crank: CRANK_PUBKEY, plan, localDate, tzOffsetMin: -now.getTimezoneOffset() }, makeFlowDeps(connection, address, signAndSend), setStatus);
      }),
    [address, connection, signAndSend, guarded],
  );

  const endShift = useCallback(
    () =>
      guarded(async () => {
        if (!address || !CRANK_PUBKEY) throw new Error('wallet or executor key not configured');
        return runEndShift({ owner: address, crank: CRANK_PUBKEY }, makeFlowDeps(connection, address, signAndSend), setStatus);
      }),
    [address, connection, signAndSend, guarded],
  );

  return { status, outcome, error, clockIn, endShift, reset: () => { setOutcome(null); setError(null); } };
}
