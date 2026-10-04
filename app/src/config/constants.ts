// E-23: ONE constant drives the RPC endpoint, the MWA chain and the cluster badge.
// NOTE: @shift/codec's program IDs are mainnet-only (ORE_NOTES §1). A non-mainnet CLUSTER shows a DEVNET badge and the app
// must treat ORE features as unavailable.
import { clusterApiUrl } from '@solana/web3.js';

export type Cluster = 'mainnet-beta' | 'devnet';

const envCluster = process.env.EXPO_PUBLIC_CLUSTER;
export const CLUSTER: Cluster = envCluster === 'devnet' ? 'devnet' : 'mainnet-beta';

/** MWA chain identifier for `authorize`. */
export const MWA_CHAIN = CLUSTER === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet';

/** Paid RPC in production via EXPO_PUBLIC_RPC_URL (PRD §9.5). Anything EXPO_PUBLIC_* ships inside the APK: use a rate-limited, origin-restricted key. */
export const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL ?? clusterApiUrl(CLUSTER);

export const IS_MAINNET = CLUSTER === 'mainnet-beta';

/** Shown to the wallet in the MWA authorize dialog. TODO(OQ-6): final URI + icon. */
export const APP_IDENTITY = { name: 'SHIFT', uri: 'https://shift-seeker.app', icon: 'favicon.ico' } as const;
