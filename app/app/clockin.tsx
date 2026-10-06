// F3 — final confirmation + guarded clock-in. The wallet only opens after: fresh chain read, conflict check, balance check,
// pre-sign invariant guard (NFR-S2/S3/S4) and a successful simulation (AC-3.3). See domain/clockInFlow.ts.
import { router, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useMemo, useState } from 'react'
import type { Role } from '@shift/codec'
import { Banner, Btn, Card, H1, P, Row, Screen } from '@/src/components/ui'
import { ROLES } from '@/src/config/roles'
import { classifyExisting } from '@/src/domain/conflict'
import type { FlowStatus } from '@/src/domain/clockInFlow'
import { formatSol, formatSolExact, formatSolUp, speakSol } from '@/src/domain/format'
import { planShift } from '@/src/domain/planShift'
import { CRANK_PUBKEY } from '@/src/config/constants'
import { loadWalletChainState, type WalletChainState } from '@/src/services/chain'
import { useFlow, type FlowOutcome } from '@/src/services/useFlow'
import { useShiftWallet } from '@/src/services/wallet'

const STATUS_TEXT: Record<FlowStatus, string> = {
  checking: 'Checking your wallet…',
  simulating: 'Checking the transaction…',
  'awaiting-wallet': 'Approve in your wallet…',
  confirming: 'Confirming on the network…',
  reconciling: 'Making sure your shift started…',
}

export default function ClockIn() {
  const params = useLocalSearchParams<{ role?: string; budget?: string; minutes?: string }>()
  const { address, connection } = useShiftWallet()
  const flow = useFlow()
  const [chain, setChain] = useState<WalletChainState | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  const plan = useMemo(() => {
    try {
      if (!params.role || !(params.role in ROLES) || !params.budget || !params.minutes) return null
      const r = planShift({ role: params.role as Role, budgetLamports: BigInt(params.budget), lengthMinutes: Number(params.minutes), nowUnix: Math.floor(Date.now() / 1000) })
      return r.ok ? r.plan : null
    } catch {
      return null
    }
  }, [params.role, params.budget, params.minutes])

  useEffect(() => {
    if (!address) return
    let live = true
    void loadWalletChainState(connection, address).then((r) => live && r.ok && setChain(r.state))
    return () => {
      live = false
    }
  }, [address, connection])

  const existing = chain && address ? classifyExisting(chain.automation, address, CRANK_PUBKEY) : null
  const busy = flow.status !== null

  useEffect(() => {
    const o = flow.outcome
    if (o?.kind === 'success') router.replace({ pathname: '/active', params: { sig: o.signature ?? '' } })
  }, [flow.outcome])

  if (!plan) {
    return (
      <Screen>
        <Banner tone="error">This shift could not be read. Go back and choose it again.</Banner>
        <Btn title="Back" onPress={() => router.back()} />
      </Screen>
    )
  }

  const out = flow.outcome
  return (
    <Screen>
      <H1>Confirm your shift</H1>
      <Card>
        <P style={{ fontWeight: '800', fontSize: 18 }} accessibilityLabel={`Max you can lose: ${speakSol(plan.budgetLamports)}`}>
          Max you can lose: {formatSol(plan.budgetLamports, 4)} SOL
        </P>
        <Row label="Role" value={ROLES[plan.role].label} />
        <Row label="Estimated rounds" value={`${plan.plannedRounds}`} />
        <Row label="Executor fees" value={`${formatSolExact(plan.totalFeeLamports)} SOL`} a11yValue={speakSol(plan.totalFeeLamports)} />
        <P muted>You will approve ONE transaction in your wallet. It puts the budget into your ORE automation and records your shift start on chain.</P>
      </Card>

      {existing?.kind === 'idle-shell' && (
        <Banner tone="warn">You have an empty ORE automation. Confirming will close it and start your shift in the same transaction.</Banner>
      )}

      {busy && (
        <Banner tone="info">
          {STATUS_TEXT[flow.status!]}
        </Banner>
      )}

      {flow.error && (
        <>
          <Banner tone="error">A safety check stopped this before anything was sent to your wallet.</Banner>
          <Btn kind="secondary" title={showDetail ? 'Hide details' : 'Details'} onPress={() => setShowDetail((v) => !v)} />
          {showDetail && <P muted style={{ fontFamily: 'monospace', fontSize: 12 }}>{flow.error}</P>}
        </>
      )}

      {out && out.kind !== 'success' && <OutcomeView out={out} showDetail={showDetail} setShowDetail={setShowDetail} />}

      {(!out || out.kind === 'cancelled' || (out.kind === 'failed' && out.retryable) || out.kind === 'simulation-failed' || (out.kind === 'blocked' && out.reason === 'chain-unavailable')) && (
        <Btn
          title={out ? 'Try again' : 'Confirm and sign'}
          busy={busy}
          disabled={busy || !CRANK_PUBKEY}
          onPress={() => void flow.clockIn(plan)}
          accessibilityHint="Opens your wallet to approve one transaction"
        />
      )}
      <Btn kind="secondary" title={out?.kind === 'failed' && !out.retryable ? 'Go to Home' : 'Back'} disabled={busy} onPress={() => (out?.kind === 'failed' && !out.retryable ? router.replace('/home') : router.back())} />
    </Screen>
  )
}

function OutcomeView({ out, showDetail, setShowDetail }: { out: Exclude<FlowOutcome, { kind: 'success' }>; showDetail: boolean; setShowDetail: (f: (v: boolean) => boolean) => void }) {
  const detail = 'error' in out && out.error ? out.error.detail : null
  let body: React.ReactNode = null
  switch (out.kind) {
    case 'cancelled':
      body = <Banner tone="info">Cancelled — nothing was sent.</Banner>
      break
    case 'simulation-failed':
      body = <Banner tone="error">{out.error.userMessage}</Banner>
      break
    case 'failed':
      body = <Banner tone={out.retryable ? 'warn' : 'error'}>{out.error.userMessage}</Banner>
      break
    case 'blocked':
      body = (
        <Banner tone="warn">
          {out.reason === 'foreign-automation'
            ? 'You already have an ORE automation with funds or run by someone else. SHIFT will not change it. Stop it in the ORE app first, then come back.'
            : out.reason === 'shift-active'
              ? 'You already have a SHIFT shift running.'
              : out.reason === 'insufficient-sol'
                ? `Not enough SOL. You need ${formatSolUp(out.shortfallLamports ?? 0n)} SOL more.`
                : out.reason === 'maintenance'
                  ? 'ORE was updated. SHIFT is in read-only maintenance mode until it is updated too.'
                  : out.reason === 'no-shift'
                    ? 'There is no running shift.'
                    : 'Could not reach the network. Check your connection and try again.'}
        </Banner>
      )
      break
  }
  return (
    <>
      {body}
      {detail && (
        <>
          <Btn kind="secondary" title={showDetail ? 'Hide details' : 'Details'} onPress={() => setShowDetail((v) => !v)} />
          {showDetail && <P muted style={{ fontFamily: 'monospace', fontSize: 12 }}>{detail}</P>}
        </>
      )}
      {out.kind === 'blocked' && out.reason === 'shift-active' && <Btn title="View my shift" onPress={() => router.replace('/active')} />}
    </>
  )
}

