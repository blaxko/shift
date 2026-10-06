// F5 — Active shift screen (AC-5.1 render within 2 s p50 via cache-first then chain, AC-5.2 stale banner, AC-5.3 Complete state).
// Everything shown is the output of reconcile(); this screen computes nothing about money itself.
// Also hosts the early "End shift & withdraw" slice of F7 (stop instruction) so test funds are never stranded; Phase 6 adds claims + OUT memo.
import { router, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { Banner, Btn, Card, H1, H2, P, ProgressBar, Row, Screen } from '@/src/components/ui'
import { IN_SIG_PREFIX_LENGTH } from '@/src/domain/shift'
import { formatOre, formatSecondsLeft, formatSol, formatSolExact, speakSol } from '@/src/domain/format'
import { CLOCK_OUT_NOTICE } from '@/src/domain/payslipText'
import { useFlow } from '@/src/services/useFlow'
import { useShiftData } from '@/src/services/useShiftData'

export default function Active() {
  const { sig } = useLocalSearchParams<{ sig?: string }>()
  const flow = useFlow()
  const [payingPrefix, setPayingPrefix] = useState<string | undefined>()
  const data = useShiftData({ ...(payingPrefix ? { payingInSigPrefix: payingPrefix } : {}), ...(sig ? { pendingClockInSignature: sig } : {}) })
  const [confirming, setConfirming] = useState(false)

  const cur = data.result?.current
  const ended = flow.outcome?.kind === 'success'
  const live = cur && (cur.status === 'active' || cur.status === 'paused' || cur.status === 'paying')

  // After a successful end-shift the hint is cleared and the chain is re-read.
  useEffect(() => {
    if (flow.outcome) {
      setPayingPrefix(undefined)
      void data.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.outcome])

  // Clock-in just confirmed but its IN memo is not in the signature index yet: say so instead of flashing "No running shift" (state: Pending).
  const pending = !cur && !!data.result?.pendingClockInSignature;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => void data.refresh(), 3_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, data.updatedAt, data.refreshing]);

  const title = pending ? 'Starting your shift…' : ended ? 'Shift ended' : cur?.status === 'paused' ? 'Your shift is paused' : cur?.status === 'paying' ? 'Ending your shift…' : live ? 'Your shift is running' : cur?.status === 'complete' ? 'Shift complete' : 'No running shift'

  const onEnd = async () => {
    if (!cur) return
    setPayingPrefix(cur.shiftId.slice(0, IN_SIG_PREFIX_LENGTH))
    await flow.endShift()
  }

  // ORE returns the unspent deposit plus the automation account's deposit when it closes (rent is not in the payslip: it is neutral).
  return (
    <Screen onRefresh={() => void data.refresh()} refreshing={data.refreshing}>
      <H1>{title}</H1>

      {data.stale && (
        <Banner tone="warn">
          {data.error?.userMessage ?? "Couldn't refresh."}
          {data.updatedAt ? ` Last updated ${new Date(data.updatedAt * 1000).toLocaleTimeString()}.` : ''}
        </Banner>
      )}

      {cur && live && (
        <Card>
          {cur.status === 'paused' && <Banner tone="warn">Shift paused — executor offline. Your funds are safe in the ORE program. You can end your shift and withdraw below.</Banner>}
          <Row label="Role" value={`${cur.role[0]!.toUpperCase()}${cur.role.slice(1)}`} />
          <ProgressBar value={cur.roundsWorked} max={cur.plannedRounds} label={`${cur.roundsWorked} of ${cur.plannedRounds} rounds worked`} />
          <Row label="Rounds worked" value={`${cur.roundsWorked} of ${cur.plannedRounds}`} />
          {cur.estimatedSecondsLeft !== null && <Row label="Time left" value={formatSecondsLeft(cur.estimatedSecondsLeft)} />}
          <Row label="Budget left in the automation" value={`${formatSol(cur.balanceLeftLamports ?? 0n)} SOL`} a11yValue={speakSol(cur.balanceLeftLamports ?? 0n)} strong />
          <Row label="Returned by ORE so far (≈ live)" value={`${formatSolExact(cur.solWon)} SOL`} a11yValue={`${speakSol(cur.solWon)}, approximately live`} />
          <Row label="ORE earned so far (≈ live, before ORE's fee)" value={`${formatOre(cur.oreEarned ?? 0n)} ORE`} />
          {cur.claimedElsewhere && <P muted>Some rewards were claimed outside SHIFT.</P>}
          {cur.unsettledRound && <P muted>The latest round is not settled yet, so these figures can still grow.</P>}
          {data.updatedAt && <P muted>Updated {new Date(data.updatedAt * 1000).toLocaleTimeString()}</P>}
        </Card>
      )}

      {cur?.status === 'complete' && !ended && (
        <Card>
          <P>Your budget has been played. ORE has closed the automation and returned what was left.</P>
          <Banner tone="warn">{CLOCK_OUT_NOTICE}.</Banner>
          <Btn title="Shift complete — see payslip" onPress={() => router.push({ pathname: '/payslip', params: { shiftId: cur.shiftId } })} />
        </Card>
      )}

      {pending && <Banner tone="info">Your clock-in is confirmed. Waiting for it to show up on the network — this usually takes a few seconds.</Banner>}
      {!cur && !pending && data.loaded && !ended && <P muted>There is no SHIFT shift on this wallet right now.</P>}
      {ended && (
        <Banner tone="info">
          Your shift was ended. ORE returns the remaining budget and the account deposit to your wallet.
          {cur ? ` ${CLOCK_OUT_NOTICE}.` : ''}
        </Banner>
      )}

      {sig ? <Btn kind="secondary" title="View the clock-in transaction" onPress={() => void Linking.openURL(`https://explorer.solana.com/tx/${sig}`)} /> : null}

      {live && !ended && (
        <Card>
          <H2>End shift early</H2>
          {!confirming ? (
            <Btn kind="secondary" title="End shift & withdraw" onPress={() => setConfirming(true)} />
          ) : (
            <>
              <P>
                This stops your shift and returns about <P style={{ fontWeight: '800' }}>{formatSol((cur?.balanceLeftLamports ?? 0n), 4)} SOL</P> of unspent budget to your wallet, plus the account deposit. Rewards you have already earned
                stay in ORE until you collect them.
              </P>
              <Btn title="Confirm: end shift" busy={flow.status !== null} disabled={flow.status !== null} onPress={() => void onEnd()} accessibilityHint="Opens your wallet to approve one transaction" />
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
