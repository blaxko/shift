// Home — no-shift state (Phase 2). Active / complete states arrive with F5/F6.
import { Redirect, router, useFocusEffect } from 'expo-router'
import { CRANK_PUBKEY } from '@/src/config/constants'
import React, { useCallback, useState } from 'react'
import { Banner, Btn, Card, H1, H2, P, Row, Screen } from '@/src/components/ui'
import { formatSol, speakSol } from '@/src/domain/format'
import { loadWalletChainState, type WalletChainState } from '@/src/services/chain'
import { useShiftWallet } from '@/src/services/wallet'
import { ellipsify } from '@/utils/ellipsify'
import type { AppError } from '@/src/domain/errors'

export default function Home() {
  const { address, connection, disconnect, ready } = useShiftWallet()
  const [state, setState] = useState<WalletChainState | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  useFocusEffect(
    useCallback(() => {
      if (!address) return
      let live = true
      void loadWalletChainState(connection, address).then((r) => {
        if (!live) return
        if (r.ok) {
          setState(r.state)
          setError(null)
        } else setError(r.error)
      })
      return () => {
        live = false
      }
    }, [address, connection]),
  )

  const onDisconnect = async () => {
    await disconnect()
    router.replace('/welcome')
  }

  if (ready && !address) return <Redirect href="/welcome" />

  // A running SHIFT shift (automation run by our executor). Full F5 state machine arrives in Phase 5.
  const running = !!(state?.automation && CRANK_PUBKEY && state.automation.executor.equals(CRANK_PUBKEY))

  return (
    <Screen>
      <H1>SHIFT</H1>
      {address && (
        <Row
          label="Wallet"
          value={ellipsify(address.toBase58(), 4)}
          a11yValue={`${address.toBase58().slice(0, 4)} ending ${address.toBase58().slice(-4)}`}
        />
      )}
      {state && <Row label="Balance" value={`${formatSol(state.balanceLamports)} SOL`} a11yValue={speakSol(state.balanceLamports)} />}
      {error && <Banner tone="warn">{error.userMessage}</Banner>}

      {running ? (
        <Card>
          <H2>Your shift is running</H2>
          <P muted>ORE is placing your bets round by round.</P>
          <Btn title="View my shift" onPress={() => router.push('/active')} />
        </Card>
      ) : (
        <Card>
          <H2>No shift today</H2>
          <P muted>Clock in once. ORE works your shift while you are away.</P>
          <Btn title="Start a shift" onPress={() => router.push('/setup')} />
        </Card>
      )}

      <Btn kind="secondary" title="How SHIFT works & risks" onPress={() => router.push('/risks')} />
      <Btn kind="secondary" title="Disconnect wallet" onPress={() => void onDisconnect()} accessibilityHint="Forgets this wallet connection on this phone" />
    </Screen>
  )
}
