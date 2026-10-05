import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useShiftWallet } from '@/src/services/wallet'

// F1 / AC-1.2: with a cached authorization the app opens straight on Home (no approval prompt needed for read-only screens).
export default function Index() {
  const { ready, address } = useShiftWallet()
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel="Loading">
        <ActivityIndicator size="large" />
      </View>
    )
  }
  return <Redirect href={address ? '/home' : '/welcome'} />
}
