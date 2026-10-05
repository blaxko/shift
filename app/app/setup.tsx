// F2 — Shift setup: role -> budget -> length -> review card. FR-2.1, FR-2.2, AC-2.1-2.5, E-5, E-6, E-11.
// Phase 2: NO signing code exists here. "Clock in" is wired in Phase 3.
import { router } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import type { Role } from '@shift/codec'
import { Banner, Btn, Card, Choice, H2, P, Row, Screen } from '@/src/components/ui'
import { BUDGET_PRESETS_LAMPORTS, LENGTH_PRESETS_MINUTES } from '@/src/config/planning'
import { CRANK_PUBKEY } from '@/src/config/constants'
import { ROLES, ROLE_ORDER } from '@/src/config/roles'
import { checkBalance, costBreakdown, type CostKind } from '@/src/domain/costs'
import { classifyExisting } from '@/src/domain/conflict'
import type { AppError } from '@/src/domain/errors'
import { formatBps, formatMinutes, formatSol, formatSolExact, formatSolUp, speakSol } from '@/src/domain/format'
import { planShift, type ShiftPlan } from '@/src/domain/planShift'
import { loadWalletChainState, type WalletChainState } from '@/src/services/chain'
import { useShiftWallet } from '@/src/services/wallet'

const COST_LABEL: Record<CostKind, string> = {
  budget: 'Shift budget',
  'automation-rent': 'ORE automation account rent',
  'miner-rent': 'ORE miner account rent',
  'checkpoint-reserve': 'ORE checkpoint reserve',
  'executor-fees': 'Executor fees (from the budget)',
  'network-fee': 'Network fee (estimate)',
}

const REASON_TEXT = {
  'min-per-square': "to meet ORE's minimum",
  'fee-share': 'to keep fees under 5 % of each round',
  both: "to meet ORE's minimum and keep fees under 5 % of each round",
} as const

const BAD_PLAN_TEXT = {
  'budget-not-positive': 'Choose a budget.',
  'budget-over-cap': 'The maximum budget is 0.5 SOL.',
  'bad-length': 'Choose a shift length.',
  'too-small': 'This budget is too small for this role. Choose a larger budget or a different role.',
} as const

export default function Setup() {
  const { address, connection } = useShiftWallet()
  const [role, setRole] = useState<Role>('balanced')
  const [budget, setBudget] = useState<bigint>(BUDGET_PRESETS_LAMPORTS[0]) // NFR-RD1: smallest preset by default
  const [minutes, setMinutes] = useState<number>(LENGTH_PRESETS_MINUTES[0])
  const [chain, setChain] = useState<WalletChainState | null>(null)
  const [chainError, setChainError] = useState<AppError | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!address) return
    let live = true
    setChainError(null)
    void loadWalletChainState(connection, address).then((r) => {
      if (!live) return
      if (r.ok) setChain(r.state)
      else setChainError(r.error)
    })
    return () => {
      live = false
    }
  }, [address, connection, reload])

  // `now` only feeds the estimated end time; recomputed whenever the choice changes.
  const result = useMemo(
    () => planShift({ role, budgetLamports: budget, lengthMinutes: minutes, nowUnix: Math.floor(Date.now() / 1000) }),
    [role, budget, minutes],
  )
  const plan: ShiftPlan | null = result.ok ? result.plan : null

  const existing = useMemo(() => (chain && address ? classifyExisting(chain.automation, address, CRANK_PUBKEY) : null), [chain, address])
  const breakdown = useMemo(
    () =>
      plan && chain && existing
        ? costBreakdown(plan, {
            hasMiner: !!chain.miner,
            minerReserveIsZero: chain.miner?.checkpointFee === 0n,
            reusesIdleShell: existing.kind === 'idle-shell',
            automationRentLamports: chain.automationRentLamports,
            minerRentLamports: chain.minerRentLamports,
          })
        : null,
    [plan, chain, existing],
  )
  const balance = useMemo(() => (breakdown && chain ? checkBalance(chain.balanceLamports, breakdown) : null), [breakdown, chain])

  const maintenance = chainError?.code === 'LAYOUT_MISMATCH'
  const blocked = existing?.kind === 'blocked'
  // Phase 3 enables signing. Until then the button never does anything.
  const clockInBlockReason = maintenance
    ? 'ORE maintenance mode'
    : !plan
      ? 'Choose a valid shift'
      : !chain
        ? 'Checking your wallet…'
        : blocked
          ? 'You already have an ORE automation'
          : balance && !balance.ok
            ? 'Not enough SOL'
            : 'Signing is added in the next build'

  return (
    <Screen>
      <H2>1. Role</H2>
      {ROLE_ORDER.map((r) => (
        <Choice key={r} label={ROLES[r].label} sub={`${ROLES[r].blurb} · ${ROLES[r].squares} of 25 squares`} selected={role === r} onPress={() => setRole(r)} />
      ))}

      <H2>2. Budget</H2>
      <P muted>The most you can lose from mining.</P>
      {BUDGET_PRESETS_LAMPORTS.map((b) => (
        <Choice key={b.toString()} label={`${formatSol(b)} SOL`} selected={budget === b} onPress={() => setBudget(b)} accessibilityLabel={speakSol(b)} />
      ))}

      <H2>3. Length</H2>
      {LENGTH_PRESETS_MINUTES.map((m) => (
        <Choice key={m} label={formatMinutes(m)} selected={minutes === m} onPress={() => setMinutes(m)} />
      ))}

      <H2>Review</H2>
      {maintenance && <Banner tone="error">{chainError!.userMessage}</Banner>}
      {chainError && !maintenance && (
        <Banner tone="warn">
          {chainError.userMessage}
        </Banner>
      )}
      {chainError && !maintenance && <Btn kind="secondary" title="Retry" onPress={() => setReload((n) => n + 1)} />}

      {!result.ok ? (
        <Banner tone="warn">{BAD_PLAN_TEXT[result.reason]}</Banner>
      ) : (
        <Card>
          <P style={{ fontWeight: '800', fontSize: 18 }} accessibilityLabel={`Max you can lose: ${speakSol(plan!.budgetLamports)}`}>
            Max you can lose: {formatSol(plan!.budgetLamports, 4)} SOL
          </P>

          <Row label="Role" value={ROLES[plan!.role].label} />
          <Row label="Each round" value={`${formatSolExact(plan!.perSquareLamports)} SOL × ${plan!.squares} squares`} a11yValue={`${speakSol(plan!.perSquareLamports)} on each of ${plan!.squares} squares`} />
          <Row label="Estimated rounds" value={`${plan!.plannedRounds}`} />
          {plan!.shortenedFrom && (
            <Banner tone="info">
              Shortened to {plan!.plannedRounds} rounds {REASON_TEXT[plan!.shortenedFrom.reason]}
            </Banner>
          )}
          <Row
            label="Estimated end"
            value={new Date(plan!.estimatedEndUnix * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
          />
          <Row
            label="Executor fees"
            value={`${formatSolExact(plan!.totalFeeLamports)} SOL (${formatBps(plan!.feeShareOfBudgetBps)} of budget)`}
            a11yValue={`${speakSol(plan!.totalFeeLamports)}, ${formatBps(plan!.feeShareOfBudgetBps)} of the budget`}
          />

          <H2>What leaves your wallet</H2>
          {!breakdown ? (
            <P muted>Checking your wallet…</P>
          ) : (
            <>
              {breakdown.lines.map((l) => (
                <Row
                  key={l.kind}
                  label={`${COST_LABEL[l.kind]} — ${l.refundable ? 'Refundable' : 'Not refundable'}`}
                  value={`${formatSolExact(l.lamports)} SOL`}
                  a11yValue={`${speakSol(l.lamports)}, ${l.refundable ? 'refundable' : 'not refundable'}`}
                />
              ))}
              <Row label="Total leaving your wallet now" value={`${formatSolExact(breakdown.totalLeavingWalletNow)} SOL`} strong a11yValue={speakSol(breakdown.totalLeavingWalletNow)} />
              <P muted>Executor fees come out of the budget, so they are not added again. Setup costs marked “Not refundable” are paid once and reused by later shifts.</P>
            </>
          )}

          {chain && balance && (
            <>
              <Row label="Your balance" value={`${formatSol(chain.balanceLamports)} SOL`} a11yValue={speakSol(chain.balanceLamports)} />
              {balance.ok ? null : (
                <Banner tone="error">
                  Not enough SOL. You need {formatSolUp(balance.shortfallLamports)} SOL more (this includes a 0.01 SOL reserve for network fees).
                </Banner>
              )}
            </>
          )}

          {existing?.kind === 'idle-shell' && (
            <Banner tone="info">
              You have an empty ORE automation. When you clock in, SHIFT will close it and start your shift in one step. You will be asked to confirm first.
            </Banner>
          )}
          {existing?.kind === 'blocked' && (
            <Banner tone="warn">
              {existing.why === 'shift-active'
                ? 'You already have a SHIFT shift running.'
                : 'You already have an ORE automation with funds or run by someone else. SHIFT will not change it. Stop it in the ORE app first, then come back.'}
            </Banner>
          )}
        </Card>
      )}

      <Btn
        title="Clock in"
        disabled
        accessibilityHint={clockInBlockReason}
      />
      <P muted>{clockInBlockReason}</P>
      <Btn kind="secondary" title="How SHIFT works & risks" onPress={() => router.push('/risks')} />
    </Screen>
  )
}
