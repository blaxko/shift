// F1 — wallet service. MWA via @wallet-ui/react-native-web3js (Mobile Wallet Adapter / Seed Vault wallets).
//  - FR-1.2: the MWA auth_token + addresses are cached in expo-secure-store (never AsyncStorage). No private key ever
//    exists in this app (NFR-S1): all signing goes through the wallet.
//  - FR-1.3 / AC-1.5: every `connect()` passes the cached token to `authorize`; if the wallet rejects it the library
//    retries without it (a normal approval prompt) and persists the fresh authorization over the stale one.
//  - FR-1.4: `disconnect()` calls `deauthorize` on the wallet and clears the cache.
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { useMobileWallet, type Cache, type WalletAuthorization } from '@wallet-ui/react-native-web3js';
import type { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { deserializeAuth, serializeAuth } from '../domain/authCache';
import type { AppError } from '../domain/errors';
import { classifyWalletError } from '../domain/walletErrors';

const KEY = 'shift_mwa_auth_v1';

export class SecureStoreAuthCache implements Cache<WalletAuthorization | undefined> {
  async get(): Promise<WalletAuthorization | undefined> {
    try {
      return deserializeAuth(await SecureStore.getItemAsync(KEY));
    } catch {
      return undefined; // unreadable keystore entry == not authorized; the next connect() prompts normally
    }
  }
  async set(value: WalletAuthorization | undefined): Promise<void> {
    if (!value) return this.clear();
    await SecureStore.setItemAsync(KEY, serializeAuth(value));
  }
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  }
}

export type ConnectResult = { ok: true; address: PublicKey } | { ok: false; error: AppError };

export function useShiftWallet() {
  const w = useMobileWallet();
  const { store } = w;
  const [ready, setReady] = useState(false);

  // Wait until the secure-store cache has been read so the app can route (Welcome vs Home) without flashing.
  useEffect(() => {
    let live = true;
    store
      .fetch()
      .catch(() => null)
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [store]);

  const connect = useCallback(async (): Promise<ConnectResult> => {
    try {
      const account = await w.connect();
      return { ok: true, address: account.address };
    } catch (e) {
      return { ok: false, error: classifyWalletError(e) };
    }
  }, [w]);

  const disconnect = useCallback(async () => {
    try {
      await w.disconnect();
    } catch {
      // Wallet unreachable: still forget the authorization locally so the user is never stuck "connected".
      await store.persist(null);
    }
  }, [w, store]);

  // NFR-S1: signing only ever happens inside the wallet app. This is the one signing entry point and it is only called
  // by the guarded flows in domain/clockInFlow.ts.
  const signAndSend = useCallback((tx: VersionedTransaction, minContextSlot: number) => w.signAndSendTransaction(tx, minContextSlot), [w]);

  return { ready, address: w.account?.address ?? null, connection: w.connection, connect, disconnect, signAndSend };
}
