import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PropsWithChildren } from 'react'
import { NetworkProvider } from '@/features/network/network-provider'
import { MobileWalletProvider } from '@wallet-ui/react-native-web3js'
import { useNetwork } from '@/features/network/use-network'
import { APP_IDENTITY } from '@/src/config/constants'
import { SecureStoreAuthCache } from '@/src/services/wallet'

const queryClient = new QueryClient()
// FR-1.2: the MWA auth_token lives in expo-secure-store, not the library's default AsyncStorage.
const authCache = new SecureStoreAuthCache()

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider>
        <SolanaNetworkProvider>{children}</SolanaNetworkProvider>
      </NetworkProvider>
    </QueryClientProvider>
  )
}

// We have this SolanaNetworkProvider because of the network switching logic.
// If you only connect to a single network, use MobileWalletProvider directly.
function SolanaNetworkProvider({ children }: PropsWithChildren) {
  const { selectedNetwork } = useNetwork()
  return (
    <MobileWalletProvider cache={authCache} chain={selectedNetwork.id} endpoint={selectedNetwork.url} identity={APP_IDENTITY}>
      {children}
    </MobileWalletProvider>
  )
}
