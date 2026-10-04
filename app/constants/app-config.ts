import { createSolanaDevnet, createSolanaMainnet, SolanaCluster } from '@wallet-ui/react-native-web3js'
import { APP_IDENTITY, CLUSTER, RPC_URL } from '@/src/config/constants'

export class AppConfig {
  static name = APP_IDENTITY.name
  static uri = APP_IDENTITY.uri
  // Single network, chosen by the CLUSTER constant (E-23).
  static networks: SolanaCluster[] = [
    CLUSTER === 'mainnet-beta'
      ? createSolanaMainnet({ label: 'Mainnet', url: RPC_URL })
      : createSolanaDevnet({ label: 'Devnet', url: RPC_URL }),
  ]
}
