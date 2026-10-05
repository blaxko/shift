// FR-1.2 — serialisation of the MWA authorization for expo-secure-store. Pure (no RN imports).
// Only what is needed to silently reauthorize is stored: the auth_token and the account addresses.
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { WalletAuthorization } from '@wallet-ui/react-native-web3js';

interface StoredAccount {
  addressBase64: string;
  label?: string;
  icon?: string;
}
interface Stored {
  v: 1;
  authToken: string;
  accounts: StoredAccount[];
  selected: string; // addressBase64
}

export function serializeAuth(auth: WalletAuthorization): string {
  const s: Stored = {
    v: 1,
    authToken: auth.authToken,
    accounts: auth.accounts.map((a) => ({ addressBase64: a.addressBase64, label: a.label, icon: a.icon })),
    selected: auth.selectedAccount.addressBase64,
  };
  return JSON.stringify(s);
}

const toAccount = (a: StoredAccount) => {
  const bytes = Buffer.from(a.addressBase64, 'base64');
  if (bytes.length !== 32) throw new Error('bad address'); // never accept a truncated / garbage key (decodes to the all-zero key otherwise)
  const address = new PublicKey(bytes);
  return { address, publicKey: address, addressBase64: a.addressBase64, label: a.label, icon: a.icon as never };
};

/** Never throws: anything unreadable means "no cached authorization" (AC-1.5 — fall back to a normal authorize). */
export function deserializeAuth(raw: string | null | undefined): WalletAuthorization | undefined {
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as Stored;
    if (s.v !== 1 || typeof s.authToken !== 'string' || !s.authToken || !Array.isArray(s.accounts) || s.accounts.length === 0) return undefined;
    const accounts = s.accounts.map(toAccount);
    const selectedAccount = accounts.find((a) => a.addressBase64 === s.selected) ?? accounts[0]!;
    return { authToken: s.authToken, accounts, selectedAccount };
  } catch {
    return undefined;
  }
}
