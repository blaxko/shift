// React hook over refresh(): cached view first (NFR-P1), then the chain; refresh on focus, on pull-to-refresh, and every 30 s while
// the app is in the foreground and this screen is focused. NO background polling (F5, NFR-P3).
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CRANK_PUBKEY } from '../config/constants';
import type { AppError } from '../domain/errors';
import { refresh } from '../domain/refresh';
import type { LocalHints, ReconcileResult } from '../domain/shift';
import { decodeResult } from '../domain/snapshotCodec';
import { getStore, makeRefreshRpc } from './shiftData';
import { useShiftWallet } from './wallet';

export interface ShiftData {
  result: ReconcileResult | null;
  balanceLamports: bigint | null;
  /** Unix seconds of the last SUCCESSFUL reconcile shown (or of the cached snapshot if the refresh failed). */
  updatedAt: number | null;
  /** AC-5.2: true when what is shown is the cached copy because the latest refresh failed. */
  stale: boolean;
  error: AppError | null;
  refreshing: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const FOREGROUND_REFRESH_MS = 30_000;

export function useShiftData(local?: LocalHints): ShiftData {
  const { address, connection } = useShiftWallet();
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inflight = useRef(false);
  const localRef = useRef(local);
  localRef.current = local;
  const wallet = address?.toBase58() ?? null;

  // Show the cached copy immediately (cold start with cached state), before any network.
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    void getStore()
      .then((s) => s.loadSnapshot(wallet))
      .then((snap) => {
        if (!live || !snap) return;
        const cached = decodeResult(snap.json);
        if (cached) {
          setResult((cur) => cur ?? cached);
          setUpdatedAt((cur) => cur ?? snap.updatedAt);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wallet]);

  const run = useCallback(async () => {
    if (!address || inflight.current) return;
    inflight.current = true;
    setRefreshing(true);
    try {
      const store = await getStore();
      const out = await refresh({ rpc: makeRefreshRpc(connection), store, nowUnix: () => Math.floor(Date.now() / 1000) }, { owner: address, crank: CRANK_PUBKEY, crankStatus: 'unknown', local: localRef.current });
      if (out.ok) {
        setResult(out.result);
        setBalance(out.balanceLamports);
        setUpdatedAt(Math.floor(Date.now() / 1000));
        setStale(false);
        setError(null);
      } else {
        setError(out.error);
        if (out.cached) {
          setResult(out.cached.result);
          setUpdatedAt(out.cached.updatedAt);
        }
        setStale(true); // AC-5.2
      }
    } catch (e) {
      // The store itself failed (disk): still never crash; show whatever we have.
      setError({ code: 'UNKNOWN', userMessage: "Couldn't refresh. Showing your last saved view.", detail: e instanceof Error ? e.message : String(e) });
      setStale(true);
    } finally {
      inflight.current = false;
      setRefreshing(false);
      setLoaded(true);
    }
  }, [address, connection]);

  useFocusEffect(
    useCallback(() => {
      void run();
      const t = setInterval(() => {
        if (AppState.currentState === 'active') void run();
      }, FOREGROUND_REFRESH_MS);
      return () => clearInterval(t);
    }, [run]),
  );

  return { result, balanceLamports: balance, updatedAt, stale, error, refreshing, loaded, refresh: run };
}
