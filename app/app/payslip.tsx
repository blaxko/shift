// F6 — Payslip. Rebuilt from chain every time (AC-6.1/6.2); the device cache only paints the first frame.
// "Losses are shown first and in plain language" (headline). NFR-A5: every gain/loss has a sign AND a label.
import { router, useLocalSearchParams } from 'expo-router'
import React from 'react'
import { Banner, Btn, Card, H1, H2, P, Row, Screen } from '@/src/components/ui'
import { formatOre, formatSol, formatSolExact, speakSol } from '@/src/domain/format'
import { describePayslip } from '@/src/domain/payslipText'
import type { Payslip } from '@/src/domain/shift'
import { useShiftData } from '@/src/services/useShiftData'

const STATUS_LABEL: Record<Payslip['status'], string> = {
  pending: 'Starting',
  active: 'In progress',
  paused: 'Paused',
  complete: 'Complete — not collected yet',
  paying: 'Collecting…',
  paid: 'PAID',
}

export default function PayslipScreen() {
  const { shiftId } = useLocalSearchParams<{ shiftId?: string }>()
  const data = useShiftData()
  const history = data.result?.history ?? []
  const p = (shiftId ? history.find((h) => h.shiftId === shiftId) : undefined) ?? history[0]

  return (
    <Screen onRefresh={() => void data.refresh()} refreshing={data.refreshing}>
      {data.stale && (
        <Banner tone="warn">
          {data.error?.userMessage ?? "Couldn't refresh."}
          {data.updatedAt ? ` Last updated ${new Date(data.updatedAt * 1000).toLocaleTimeString()}.` : ''}
        </Banner>
      )}

      {!p ? (
        <>
          <H1>Payslip</H1>
          <P muted>{data.loaded ? 'No shifts found for this wallet yet.' : 'Loading…'}</P>
        </>
      ) : (
        <PayslipView p={p} />
      )}

      {history.length > 1 && (
        <Card>
          <H2>Earlier shifts</H2>
          {history
            .filter((h) => h.shiftId !== p?.shiftId)
            .map((h) => (
              <Btn
                key={h.shiftId}
                kind="secondary"
                title={`${h.localDate} · ${h.role[0]!.toUpperCase()}${h.role.slice(1)} · ${STATUS_LABEL[h.status]}`}
                onPress={() => router.replace({ pathname: '/payslip', params: { shiftId: h.shiftId } })}
              />
            ))}
        </Card>
      )}
      <Btn kind="secondary" title="Home" onPress={() => router.replace('/home')} />
    </Screen>
  )
}

function PayslipView({ p }: { p: Payslip }) {
  const t = describePayslip(p)
  const ended = p.status === 'complete' || p.status === 'paid'
  return (
    <>
      <H1>{p.status === 'paid' ? 'Payslip — PAID' : 'Payslip'}</H1>
      <P muted>
        {p.localDate} · {p.role[0]!.toUpperCase()}
        {p.role.slice(1)} · {STATUS_LABEL[p.status]}
      </P>

      <Card>
        <P style={{ fontWeight: '800', fontSize: 18 }}>{t.headline}</P>
        <Row label={t.net.label} value={t.net.value} strong a11yValue={`${t.net.label}: ${t.net.value.replace('−', 'minus ').replace('+', 'plus ')}`} />
      </Card>

      {p.needsClockOut && <Banner tone="warn">Clock out within 24 h to keep your final round&rsquo;s rewards.</Banner>}
      {t.notes.filter((n) => !n.startsWith('Clock out within')).map((n) => (
        <P key={n} muted>
          {n}
        </P>
      ))}

      <Card>
        <H2>Details</H2>
        <Row label="Rounds worked" value={`${p.roundsWorked} of ${p.plannedRounds} planned`} />
        <Row label="SOL played" value={`${formatSolExact(p.solDeployed)} SOL`} a11yValue={speakSol(p.solDeployed)} />
        <Row label="Executor fees" value={`${formatSolExact(p.executorFees)} SOL`} a11yValue={speakSol(p.executorFees)} />
        <Row label="SOL returned by ORE during rounds" value={`${formatSolExact(p.solWon)} SOL`} a11yValue={speakSol(p.solWon)} />
        <Row
          label={p.status === 'paid' ? 'ORE collected (after ORE’s fee)' : 'ORE earned (before ORE’s fee)'}
          value={p.oreEarned === null ? 'unavailable' : `${formatOre(p.oreEarned)} ORE`}
        />
        {ended && <Row label="Unspent budget returned" value={`${formatSolExact(p.returnedAtClose)} SOL`} a11yValue={speakSol(p.returnedAtClose)} />}
        {p.setupCost > 0n && <Row label="One-time setup — not refundable" value={`${formatSolExact(p.setupCost)} SOL`} a11yValue={`${speakSol(p.setupCost)}, not refundable`} />}
        <Row label={t.net.label} value={t.net.value} strong />
        <P muted>Budget {formatSol(p.budgetLamports)} SOL</P>
      </Card>

      {p.status === 'complete' && p.needsClockOut && (
        <Card>
          <H2>Clock out &amp; collect</H2>
          <P muted>Collecting your rewards in one step arrives in the next build.</P>
          <Btn title="Clock out & collect" disabled accessibilityHint="Not available yet in this build" />
        </Card>
      )}
    </>
  )
}
