// Minimal ACTIVE screen for Phase 3 (AC-3.2: "show the active shift screen"). The full F5 screen (progress ring, payslip, crank
// status) arrives in Phase 5 on top of the reconciler. Values here are read straight from the on-chain Automation account.
// Also hosts the early "End shift & withdraw" slice of F7 so test funds are never stranded; Phase 6 adds claims + OUT memo.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Linking } from 'react-native'
import { Banner, Btn, Card, H1, H2, P, Row, Screen } from '@/src/components/ui'
import { CRANK_PUBKEY } from '@/src/config/constants'
import type { AppError } from '@/src/domain/errors'
import { formatSol, formatSolExact, speakSol } from '@/src/domain/format'
import { loadWalletChainState, type WalletChainState } from '@/src/services/chain'
import { useFlow } from '@/src/services/useFlow'
import { useShiftWallet } from '@/src/services/wallet'

const popcount = (m: bigint) => m.toString(2).replace(/0/g, '').length

export default function Active() {
  const { sig } = useLocalSearchParams<{ sig?: string }>()
  const { address, connection } = useShiftWallet()
  const flow = useFlow()
  const [state, setState] = useState<WalletChainState | null>(null)
  const [err, setErr] = useState<AppError | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)

  const load = useCallback(() => {
    if (!address) return
    void loadWalletChainState(connection, address).then((r) => {
      if (r.ok) {
        setState(r.state)
        setErr(null)
        setLoadedAt(Date.now())
      } else setErr(r.error)
    })
  }, [address, connection])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const a = state?.automation && CRANK_PUBKEY && state.automation.executor.equals(CRANK_PUBKEY) ? state.automation : null
  const squares = a ? popcount(a.mask) : 0
  const perRound = a ? a.amount * BigInt(squares) + a.fee : 0n
  const roundsLeft = a && perRound > 0n ? Number(a.balance / perRound) : 0
  // ORE closes the account and returns everything it holds: the budget still in it plus its rent.
  const returnEstimate = a ? a.balance + (state?.automationRentLamports ?? 0n) : 0n
  const ended = flow.outcome?.kind === 'success'

  return (
    <Screen>
      <H1>{ended ? 'Shift ended' : a ? 'Your shift is running' : 'No running shift'}</H1>
      {err && <Banner tone="warn">{err.userMessage}</Banner>}

      {a && (
        <Card>
          <Row label="Budget left in the automation" value={`${formatSol(a.balance, 4)} SOL`} a11yValue={speakSol(a.balance)} strong />
          <Row label="Each round" value={`${formatSolExact(a.amount)} SOL × ${squares} squares + fee ${formatSolExact(a.fee)}`} a11yValue={`${speakSol(a.amount)} on each of ${squares} squares plus a fee of ${speakSol(a.fee)}`} />
          <Row label="Rounds your budget still covers" value={`${roundsLeft}`} />
          <P muted>ORE places your bets round by round. This screen reads the chain directly; the full shift screen with progress and payslip is coming.</P>
          {loadedAt && <P muted>Last updated {new Date(loadedAt).toLocaleTimeString()}</P>}
        </Card>
      )}

      {!a && !ended && state && <P muted>There is no SHIFT automation on this wallet right now.</P>}
      {ended && <Banner tone="info">Your shift was ended. ORE returns the remaining budget and the account deposit to your wallet.</Banner>}

      {sig ? <Btn kind="secondary" title="View the clock-in transaction" onPress={() => void Linking.openURL(`https://explorer.solana.com/tx/${sig}`)} /> : null}
      <Btn kind="secondary" title="Refresh" onPress={load} />

      {a && !ended && (
        <Card>
          <H2>End shift early</H2>
          {!confirming ? (
            <Btn kind="secondary" title="End shift & withdraw" onPress={() => setConfirming(true)} />
          ) : (
            <>
              <P>
                This stops your shift and returns about <P style={{ fontWeight: '800' }}>{formatSol(returnEstimate, 4)} SOL</P> to your wallet (the unspent budget plus the account deposit). Rewards you have already earned
                stay in ORE until you collect them.
              </P>
              <Btn
                title="Confirm: end shift"
                busy={flow.status !== null}
                disabled={flow.status !== null}
                onPress={() => void flow.endShift()}
                accessibilityHint="Opens your wallet to approve one transaction"
              />
              <Btn kind="secondary" title="Keep my shift" disabled={flow.status !== null} onPress={() => setConfirming(false)} />
            </>
          )}
          {flow.status && <Banner tone="info">{flow.status === 'awaiting-wallet' ? 'Approve in your wallet…' : 'Working…'}</Banner>}
          {flow.error && <Banner tone="error">A safety check stopped this before anything was sent: {flow.error}</Banner>}
          {flow.outcome && flow.outcome.kind !== 'success' && <Banner tone="warn">{outcomeText(flow.outcome)}</Banner>}
        </Card>
      )}

      <Btn kind="secondary" title="Home" onPress={() => router.replace('/home')} />
    </Screen>
  )
}

function outcomeText(o: NonNullable<ReturnType<typeof useFlow>['outcome']>): string {
  switch (o.kind) {
    case 'cancelled':
      return 'Cancelled — nothing was sent.'
    case 'simulation-failed':
    case 'failed':
      return o.error.userMessage
    case 'blocked':
      return o.reason === 'foreign-automation' ? 'This automation is not a SHIFT shift, so SHIFT will not change it.' : o.reason === 'no-shift' ? 'There is no running shift.' : 'Could not check your shift right now. Try again.'
    default:
      return ''
  }
}
