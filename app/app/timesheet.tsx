// F9 — Timesheet: month calendar (FR-9.1), streak, PTO, probation. Everything is derived from the on-chain memo ledger via reconcile(),
// so a reinstall shows the same streak (AC-9.2).
import { router } from 'expo-router'
import React, { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Banner, Btn, Card, H1, H2, P, Screen, useTheme } from '@/src/components/ui'
import { formatSolExact } from '@/src/domain/format'
import { computeStreak, localToday, monthGrid } from '@/src/domain/streak'
import { dayLabel, describeStreak, monthName } from '@/src/domain/streakText'
import { useShiftData } from '@/src/services/useShiftData'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Timesheet() {
  const t = useTheme()
  const data = useShiftData()
  const today = localToday()
  const [year0, month0] = today.split('-').map(Number) as [number, number]
  const [ym, setYm] = useState({ y: year0, m: month0 })

  const days = useMemo(() => data.result?.shiftDays ?? [], [data.result])
  const streak = useMemo(() => computeStreak(days, today), [days, today])
  const text = describeStreak(streak)
  const grid = useMemo(() => monthGrid(ym.y, ym.m, days), [ym, days])

  const step = (delta: number) =>
    setYm(({ y, m }) => {
      const n = y * 12 + (m - 1) + delta
      return { y: Math.floor(n / 12), m: (n % 12) + 1 }
    })

  const prefix = `${ym.y}-${String(ym.m).padStart(2, '0')}`
  const monthShifts = (data.result?.history ?? []).filter((h) => h.localDate.startsWith(prefix))
  const daysWorked = new Set(monthShifts.map((h) => h.localDate)).size

  return (
    <Screen onRefresh={() => void data.refresh()} refreshing={data.refreshing}>
      <H1>Timesheet</H1>
      {data.stale && <Banner tone="warn">{data.error?.userMessage ?? "Couldn't refresh."} Showing your last saved view.</Banner>}

      <Card>
        <H2>{text.streakLine}</H2>
        <P muted>{text.ptoLine}</P>
        {text.riskLine && <Banner tone="info">{text.riskLine}</Banner>}
        {text.probationLine && <P>{text.probationLine}</P>}
        {text.hiredBadge && <P style={{ fontWeight: '800' }} accessibilityLabel="Hired. You completed your probation week.">{text.hiredBadge}</P>}
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Btn kind="secondary" title="‹" accessibilityLabel="Previous month" onPress={() => step(-1)} />
        <H2>
          {monthName(ym.m)} {ym.y}
        </H2>
        <Btn kind="secondary" title="›" accessibilityLabel="Next month" onPress={() => step(1)} />
      </View>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants">
          {WEEKDAYS.map((d) => (
            <Text key={d} maxFontSizeMultiplier={1.3} style={{ flex: 1, textAlign: 'center', color: t.muted, fontSize: 12 }}>
              {d}
            </Text>
          ))}
        </View>
        {grid.map((week, wi) => (
          <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
            {week.map((c, ci) =>
              c === null ? (
                <View key={ci} style={{ flex: 1, minHeight: 48 }} />
              ) : (
                <View
                  key={ci}
                  accessible
                  accessibilityLabel={`${dayLabel(c.date, c.count)}${c.date === today ? ', today' : ''}`}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                    borderWidth: c.date === today ? 3 : 1,
                    borderColor: c.date === today ? t.primary : t.border,
                    backgroundColor: c.marked ? t.primary : t.card,
                  }}
                >
                  <Text maxFontSizeMultiplier={1.3} style={{ color: c.marked ? t.onPrimary : t.text, fontWeight: c.marked ? '800' : '500' }}>{c.day}</Text>
                  {/* NFR-A5: a mark you can read without colour */}
                  <Text maxFontSizeMultiplier={1.3} style={{ color: c.marked ? t.onPrimary : t.muted, fontSize: 11 }}>{c.marked ? (c.count > 1 ? `✓×${c.count}` : '✓') : ' '}</Text>
                </View>
              ),
            )}
          </View>
        ))}
      </View>
      <P muted>
        {monthShifts.length} {monthShifts.length === 1 ? 'shift' : 'shifts'} on {daysWorked} {daysWorked === 1 ? 'day' : 'days'} in {monthName(ym.m)}. ✓ = a day you clocked in.
      </P>

      {monthShifts.length > 0 && (
        <Card>
          <H2>Shifts this month</H2>
          {monthShifts.map((h) => (
            <Btn
              key={h.shiftId}
              kind="secondary"
              title={`${h.localDate} · ${h.role[0]!.toUpperCase()}${h.role.slice(1)} · ${h.netSol < 0n ? '−' : h.netSol > 0n ? '+' : ''}${formatSolExact(h.netSol < 0n ? -h.netSol : h.netSol)} SOL`}
              accessibilityLabel={`${h.localDate}, ${h.role}, net ${h.netSol < 0n ? 'loss' : h.netSol > 0n ? 'gain' : 'break-even'} of ${formatSolExact(h.netSol < 0n ? -h.netSol : h.netSol)} SOL`}
              onPress={() => router.push({ pathname: '/payslip', params: { shiftId: h.shiftId } })}
            />
          ))}
        </Card>
      )}
      <Btn kind="secondary" title="Home" onPress={() => router.replace('/home')} />
    </Screen>
  )
}
