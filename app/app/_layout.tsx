import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Start a shift' }} />
        <Stack.Screen name="clockin" options={{ title: 'Confirm shift' }} />
        <Stack.Screen name="active" options={{ title: 'Your shift', headerBackVisible: false }} />
        <Stack.Screen name="payslip" options={{ title: 'Payslip' }} />
        <Stack.Screen name="risks" options={{ title: 'How SHIFT works & risks' }} />
        <Stack.Screen name="smoke" options={{ title: 'Diagnostics' }} />
      </Stack>
      <StatusBar style="auto" />
    </AppProviders>
  )
}
