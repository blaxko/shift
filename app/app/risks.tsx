// NFR-RD2 / NFR-S8 — "How SHIFT works & risks". Plain language; the precise source citations are in docs/TRUST_MODEL.md.
import { router } from 'expo-router'
import React from 'react'
import { Btn, Card, H1, H2, P, Screen } from '@/src/components/ui'

export default function Risks() {
  return (
    <Screen>
      <H1>How SHIFT works & risks</H1>

      <H2>What it does</H2>
      <P>
        SHIFT starts an ORE automation for you. You put in a fixed budget; each round (about every 78 seconds) a SHIFT server places that round’s bets for you.
        You sign once to start and once to finish.
      </P>

      <H2>What you can lose</H2>
      <Card>
        <P>• Your budget is the most you can lose from mining. Mining is a game of chance and you can get back less than you put in.</P>
        <P>• Some one-off costs are not refundable: ORE account setup the first time (a Miner account and a small checkpoint reserve). The review card shows each cost and whether it is refundable.</P>
        <P>• A small flat fee per round goes to the server that places your bets. It comes out of your budget.</P>
        <P>• Network fees apply to every transaction you sign.</P>
      </Card>

      <H2>What the server can and cannot do</H2>
      <Card>
        <P>• It can place bets for you only at the amount and squares you chose, and only up to your budget.</P>
        <P>• It cannot withdraw your funds, claim your rewards, change your settings, or touch the rest of your wallet.</P>
        <P>• If it stops, your funds stay in the ORE program and you can end the shift and withdraw at any time.</P>
        <P>• Your wallet app signs everything. SHIFT never sees or stores your keys.</P>
      </Card>

      <H2>Please play responsibly</H2>
      <P>Only use money you can afford to lose. Start with the smallest budget. SHIFT will never ask you to win it back.</P>

      <Btn kind="secondary" title="Diagnostics" onPress={() => router.push('/smoke')} />
    </Screen>
  )
}
