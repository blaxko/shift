// F1 — Welcome / connect. AC-1.1 (home after approval), AC-1.3 (no wallet installed), AC-1.4 (rejected).
import { router } from 'expo-router'
import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { Banner, Btn, Card, H1, P, Screen } from '@/src/components/ui'
import type { AppError } from '@/src/domain/errors'
import { useShiftWallet } from '@/src/services/wallet'

// Generic Play Store search: no wallet is endorsed, any Mobile Wallet Adapter wallet works.
const FIND_WALLET_URL = 'https://play.google.com/store/search?q=solana%20wallet&c=apps'

export default function Welcome() {
  const { connect } = useShiftWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const onConnect = async () => {
    setBusy(true)
    setError(null)
    setShowDetail(false)
    const r = await connect()
    setBusy(false)
    if (r.ok) router.replace('/home')
    else setError(r.error)
  }

  return (
    <Screen>
      <View style={{ height: 24 }} />
      <H1>Clock in once. ORE works your shift.</H1>
      <P muted>Fund a capped shift with one signature. Come back later to a payslip. Collect at clock-out.</P>

      <Card>
        <P>• You see your maximum loss before you sign anything.</P>
        <P>• One signature to start, one to finish.</P>
        <P>• SHIFT never holds your keys. Your wallet signs everything.</P>
      </Card>

      {error?.code === 'NO_WALLET' ? (
        <Card>
          <P style={{ fontWeight: '800' }}>{error.userMessage}</P>
          <P muted>SHIFT connects through Mobile Wallet Adapter (your Seed Vault or another Solana wallet app that supports it). Install one, then come back and try again.</P>
          <Btn kind="secondary" title="Find a wallet on Google Play" onPress={() => void Linking.openURL(FIND_WALLET_URL)} />
        </Card>
      ) : error?.code === 'USER_REJECTED' ? (
        <Banner tone="info">{error.userMessage}</Banner>
      ) : error ? (
        <Banner tone="error">{error.userMessage}</Banner>
      ) : null}

      <Btn title={error?.code === 'NO_WALLET' ? 'Try again' : 'Connect wallet'} onPress={() => void onConnect()} busy={busy} accessibilityHint="Opens your wallet to approve the connection" />

      {error && error.code !== 'USER_REJECTED' && (
        <>
          <Btn kind="secondary" title={showDetail ? 'Hide details' : 'Details'} onPress={() => setShowDetail((v) => !v)} />
          {showDetail && <P muted style={{ fontFamily: 'monospace', fontSize: 12 }}>{error.detail}</P>}
        </>
      )}

      <Btn kind="secondary" title="How SHIFT works & risks" onPress={() => router.push('/risks')} />
    </Screen>
  )
}
