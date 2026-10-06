// Home: today's state (PRD §7). No shift / running / complete (with the AC-6.5 notice). Values come from reconcile(); the cache only
// paints the first frame and covers a failed refresh (AC-5.2).
import { Redirect, router } from 'expo-router'
import React from 'react'
import { Banner, Btn, Card, H1, H2, P, ProgressBar, Row, Screen } from '@/src/components/ui'
import { describePayslip, CLOCK_OUT_NOTICE } from '@/src/domain/payslipText'
import { formatSecondsLeft, formatSol, speakSol } from '@/src/domain/format'
import { useShiftData } from '@/src/services/useShiftData'
import { useShiftWallet } from '@/src/services/wallet'
import { ellipsify } from '@/utils/ellipsify'

export default function Home() {
  const { address, disconnect, ready } = useShiftWallet()
  const data = useShiftData()
  if (ready && !address) return <Redirect href="/welcome" />

  const onDisconnect = async () => {
    await disconnect()
    router.replace('/welcome')
  }

  const cur = data.result?.current
  const last = data.result?.history[0]
  const live = cur && (cur.status === 'active' || cur.status === 'paused' || cur.status === 'paying')

  return (
    <Screen onRefresh={() => void data.refresh()} refreshing={data.refreshing}>
      <H1>SHIFT</H1>
      {address && (
        <Row label="Wallet" value={ellipsify(address.toBase58(), 4)} a11yValue={`${address.toBase58().slice(0, 4)} ending ${address.toBase58().slice(-4)}`} />
      )}
      {data.balanceLamports !== null && <Row label="Balance" value={`${formatSol(data.balanceLamports)} SOL`} a11yValue={speakSol(data.balanceLamports)} />}
      {data.stale && (
        <Banner tone="warn">
          {data.error?.userMessage ?? "Couldn't refresh."}
          {data.updatedAt ? ` Last updated ${new Date(data.updatedAt * 1000).toLocaleTimeString()}.` : ''}
        </Banner>
      )}

      {live ? (
        <Card>
          <H2>{cur.status === 'paused' ? 'Your shift is paused' : cur.status === 'paying' ? 'Ending your shift…' : 'Your shift is running'}</H2>
          <ProgressBar value={cur.roundsWorked} max={cur.plannedRounds} label={`${cur.roundsWorked} of ${cur.plannedRounds} rounds`} />
          <P muted>
            {cur.roundsWorked} of {cur.plannedRounds} rounds
            {cur.estimatedSecondsLeft !== null ? ` · ${formatSecondsLeft(cur.estimatedSecondsLeft)} left` : ''}
          </P>
          <Btn title="View my shift" onPress={() => router.push('/active')} />
        </Card>
      ) : cur?.status === 'complete' ? (
        <Card>
          <H2>Shift complete</H2>
          <P>{describePayslip(cur).headline}</P>
          {cur.needsClockOut && <Banner tone="warn">{CLOCK_OUT_NOTICE}.</Banner>}
          <Btn title={cur.canClockOut ? 'Clock out & collect' : 'See payslip'} onPress={() => router.push({ pathname: '/payslip', params: { shiftId: cur.shiftId } })} />
        </Card>
      ) : (
        <Card>
          <H2>No shift today</H2>
          <P muted>Clock in once. ORE works your shift while you are away.</P>
          <Btn title="Start a shift" onPress={() => router.push('/setup')} />
          {last && <Btn kind="secondary" title="Last payslip" onPress={() => router.push({ pathname: '/payslip', params: { shiftId: last.shiftId } })} />}
        </Card>
      )}

      <Btn kind="secondary" title="How SHIFT works & risks" onPress={() => router.push('/risks')} />
      <Btn kind="secondary" title="Disconnect wallet" onPress={() => void onDisconnect()} accessibilityHint="Forgets this wallet connection on this phone" />
    </Screen>
  )
}
