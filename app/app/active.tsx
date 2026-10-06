// F5 — Active shift screen (AC-5.1 render within 2 s p50 via cache-first then chain, AC-5.2 stale banner, AC-5.3 Complete state).
// Everything shown is the output of reconcile(); this screen computes nothing about money itself.
// Hosts "End shift & withdraw": the same single clock-out transaction as "Clock out & collect" (F7, AC-7.1, AC-7.3).
import { router, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import { ClockOutPanel } from '@/src/components/ClockOutPanel'
import { Banner, Btn, Card, H1, P, ProgressBar, Row, Screen } from '@/src/components/ui'
import { formatOre, formatSecondsLeft, formatSol, formatSolExact, speakSol } from '@/src/domain/format'
import { CLOCK_OUT_NOTICE } from '@/src/domain/payslipText'
import { useShiftData } from '@/src/services/useShiftData'

export default function Active() {
  const { sig } = useLocalSearchParams<{ sig?: string }>()
  const [payingPrefix, setPayingPrefix] = useState<string | undefined>()
  const data = useShiftData({ ...(payingPrefix ? { payingInSigPrefix: payingPrefix } : {}), ...(sig ? { pendingClockInSignature: sig } : {}) })

  const cur = data.result?.current
  const live = cur && (cur.status === 'active' || cur.status === 'paused' || cur.status === 'paying')

  // Clock-in just confirmed but its IN memo is not in the signature index yet: say so instead of flashing "No running shift" (state: Pending).
  const pending = !cur && !!data.result?.pendingClockInSignature;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => void data.refresh(), 3_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, data.updatedAt, data.refreshing]);

  const title = pending ? 'Starting your shift…' : cur?.status === 'paused' ? 'Your shift is paused' : cur?.status === 'paying' ? 'Ending your shift…' : live ? 'Your shift is running' : cur?.status === 'complete' ? 'Shift complete' : 'No running shift'

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

      {cur?.status === 'complete' && (
        <Card>
          <P>This shift has ended. ORE closed the automation and returned any unspent budget to your wallet.</P>
          {cur.needsClockOut && <Banner tone="warn">{CLOCK_OUT_NOTICE}.</Banner>}
          <Btn title="Shift complete — see payslip" onPress={() => router.push({ pathname: '/payslip', params: { shiftId: cur.shiftId } })} />
        </Card>
      )}

      {!cur && data.result?.history[0]?.status === 'paid' && (
        <Card>
          <P>Your last shift is PAID: it was clocked out and your rewards were collected.</P>
          <Btn title="See payslip" onPress={() => router.push({ pathname: '/payslip', params: { shiftId: data.result!.history[0]!.shiftId } })} />
        </Card>
      )}
      {pending && <Banner tone="info">Your clock-in is confirmed. Waiting for it to show up on the network — this usually takes a few seconds.</Banner>}
      {!cur && !pending && data.loaded && data.result?.history[0]?.status !== 'paid' && <P muted>There is no SHIFT shift on this wallet right now.</P>}
      {sig ? <Btn kind="secondary" title="View the clock-in transaction" onPress={() => void Linking.openURL(`https://explorer.solana.com/tx/${sig}`)} /> : null}

      {/* Stays mounted while Paying (reconcile flips the status to 'paying' the moment a clock-out starts) so the flow's status is not lost. */}
      {cur && live && (cur.canClockOut || cur.status === 'paying') && <ClockOutPanel p={cur} onPaying={setPayingPrefix} onFinished={() => void data.refresh()} />}

      <Btn kind="secondary" title="Home" onPress={() => router.replace('/home')} />
    </Screen>
  )
}

