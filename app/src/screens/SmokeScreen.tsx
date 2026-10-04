// Phase 2 task #1 — DEVICE SMOKE SCREEN (temporary; replaced by the real screens once DEVICE_TEST S-1 passes).
// Proves on a real Seeker: MWA connect, live RPC, @shift/codec decoding, Buffer/BigInt/PDA/builders on Hermes,
// expo-secure-store and expo-sqlite. No transaction is ever built for signing here.
import { Buffer } from 'buffer';
import React, { useCallback, useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { PublicKey } from '@solana/web3.js';
import { useMobileWallet } from '@wallet-ui/react-native-web3js';
import {
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  InvariantViolation,
  MAX_DEPOSIT_LAMPORTS,
  ORE_PROGRAM_ID,
  TREASURY_ADDRESS,
  automate,
  decode,
  formatInMemo,
  parseMemo,
  pdas,
  stopAutomation,
  type Automation,
  type Board,
  type Config,
  type Miner,
} from '@shift/codec';
import { CLUSTER, IS_MAINNET, RPC_URL } from '@/src/config/constants';

// A live automation seen in the Phase 0 fixtures (permissionless executor, reload on). Display only.
const SAMPLE_AUTOMATION = new PublicKey('5dV8F9UjinWVAzQL6eowcks6sBKaXuLHZovXMzFGDTg');

const sol = (l: bigint) => {
  const s = l.toString().padStart(10, '0');
  return `${s.slice(0, -9)}.${s.slice(-9)}`;
};

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function runSelfTest(): Promise<Check[]> {
  const out: Check[] = [];
  const t = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try {
      const detail = await fn();
      out.push({ name, ok: true, detail: String(detail ?? '') });
    } catch (e) {
      out.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const user = new PublicKey('3sTPtk6VT6hvoJmzVyB8Mqd6gzgVzxr1taMZ7RNtVJsC');
  const crank = new PublicKey('HNWhK5f8RMWBqcA7mXJPaxdTPGrha3rrqUrri7HSKb3T');

  await t('Buffer polyfill', () => {
    if (Buffer.from('ff00', 'hex')[0] !== 255) throw new Error('hex decode wrong');
    return 'ok';
  });
  await t('BigInt u64 round-trip', () => {
    const max = (1n << 64n) - 1n;
    const dv = new DataView(new ArrayBuffer(8));
    dv.setBigUint64(0, max, true);
    if (dv.getBigUint64(0, true) !== max) throw new Error('DataView bigint');
    if (max.toString() !== '18446744073709551615') throw new Error('toString');
    return max.toString();
  });
  await t('PDA derivation (sha256 + curve) board == constant', () => {
    if (!pdas.board().equals(BOARD_ADDRESS)) throw new Error(pdas.board().toBase58());
    if (!pdas.treasury().equals(TREASURY_ADDRESS)) throw new Error('treasury');
    if (!pdas.config().equals(CONFIG_ADDRESS)) throw new Error('config');
    return BOARD_ADDRESS.toBase58().slice(0, 8) + '…';
  });
  await t('automate() builder: 66 bytes, Preferred, reload 0', () => {
    const ix = automate({ authority: user, executor: crank, amount: 1000n, deposit: 50_000_000n, fee: 1000n, mask: 31n, reload: false });
    if (ix.data.length !== 66) throw new Error(`len ${ix.data.length}`);
    if (ix.data[33] !== 1) throw new Error('strategy');
    if (ix.data.subarray(34, 42).some((b) => b !== 0)) throw new Error('reload');
    return `len ${ix.data.length}, ${ix.keys.length} accounts`;
  });
  await t('NFR-S3 guard throws above 0.5 SOL', () => {
    try {
      automate({ authority: user, executor: crank, amount: 1000n, deposit: MAX_DEPOSIT_LAMPORTS + 1n, fee: 1000n, mask: 31n, reload: false });
    } catch (e) {
      if (e instanceof InvariantViolation) return e.rule;
      throw e;
    }
    throw new Error('did not throw');
  });
  await t('stopAutomation(): executor = default pubkey', () => {
    const ix = stopAutomation(user);
    if (!ix.keys[2]!.pubkey.equals(PublicKey.default)) throw new Error('executor');
    return 'ok';
  });
  await t('memo format/parse + look-alike rejected', () => {
    const text = formatInMemo({ role: 'safe', budget: 20_000_000n, perSquare: 1000n, squares: 20, feePerRound: 1000n, setupLamports: 0n, baseLifeSol: 0n, baseLifeDeployed: 0n, baseOre: 0n, localDate: '2026-10-04', tzOffsetMin: 60 });
    if (parseMemo(text)?.kind !== 'IN') throw new Error('roundtrip');
    if (parseMemo(text.replace('SHIFT1', 'SHIFT2')) !== null) throw new Error('v2 accepted');
    return `${text.length} bytes`;
  });
  await t('expo-secure-store set/get/delete', async () => {
    const v = `shift-smoke-${Date.now()}`;
    await SecureStore.setItemAsync('shift_smoke', v);
    const back = await SecureStore.getItemAsync('shift_smoke');
    await SecureStore.deleteItemAsync('shift_smoke');
    if (back !== v) throw new Error('mismatch');
    return 'ok';
  });
  await t('expo-sqlite in-memory query', async () => {
    const db = await SQLite.openDatabaseAsync(':memory:');
    const row = await db.getFirstAsync<{ v: number }>('SELECT 1 + 1 AS v');
    await db.closeAsync();
    if (row?.v !== 2) throw new Error(JSON.stringify(row));
    return 'ok';
  });
  return out;
}

interface Live {
  board: Board;
  config: Config;
  sample: Automation;
  walletAutomation: Automation | null;
  walletMiner: Miner | null;
  ms: number;
}

export function SmokeScreen() {
  const { account, connect, disconnect, connection } = useMobileWallet();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    runSelfTest().then(setChecks);
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const t0 = Date.now();
      const wallet = account?.address;
      const keys = [BOARD_ADDRESS, CONFIG_ADDRESS, SAMPLE_AUTOMATION, ...(wallet ? [pdas.automation(wallet), pdas.miner(wallet)] : [])];
      // ONE RPC call (NFR-P3).
      const infos = await connection.getMultipleAccountsInfo(keys, 'confirmed');
      const raw = (i: number) => {
        const a = infos[i];
        return a ? { owner: a.owner, data: a.data } : null;
      };
      const need = (i: number, what: string) => {
        const r = raw(i);
        if (!r) throw new Error(`${what} account missing`);
        return r;
      };
      const wa = wallet ? raw(3) : null;
      const wm = wallet ? raw(4) : null;
      setLive({
        board: decode.board(need(0, 'board')),
        config: decode.config(need(1, 'config')),
        sample: decode.automation(need(2, 'sample automation')),
        walletAutomation: wa ? decode.automation(wa) : null,
        walletMiner: wm ? decode.miner(wm) : null,
        ms: Date.now() - t0,
      });
      if (wallet) setBalance(await connection.getBalance(wallet));
    } catch (e) {
      // LayoutMismatch lands here too (E-11) — the real app will switch to read-only Maintenance mode.
      setErr(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }, [account, connection]);

  const passed = checks?.filter((c) => c.ok).length ?? 0;
  const total = checks?.length ?? 0;

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.title} accessibilityRole="header">
          SHIFT — device smoke test
        </Text>
        <Text style={s.mono}>
          cluster {CLUSTER}
          {IS_MAINNET ? '' : '  (DEVNET: ORE features unavailable)'}
        </Text>
        <Text style={s.mono}>rpc {RPC_URL.replace(/\/\/([^/]{0,40}).*/, '//$1…')}</Text>
        <Text style={s.mono}>ore {ORE_PROGRAM_ID.toBase58().slice(0, 12)}…</Text>

        <Text style={s.h}>1. Wallet (MWA / Seed Vault)</Text>
        {account ? (
          <>
            <Text style={s.mono}>connected {account.address.toBase58()}</Text>
            <Text style={s.mono}>balance {balance === null ? '…' : `${sol(BigInt(balance))} SOL`}</Text>
            <Button title="Disconnect" onPress={() => void disconnect()} />
          </>
        ) : (
          <Button title="Connect wallet" onPress={() => void connect().catch((e) => setErr(String(e)))} />
        )}

        <Text style={s.h}>2. Live chain via @shift/codec</Text>
        <Button title={busy ? 'Fetching…' : 'Fetch & decode'} disabled={busy} onPress={() => void refresh()} />
        {err && <Text style={s.bad}>ERROR {err}</Text>}
        {live && (
          <View>
            <Text style={s.ok}>1 RPC call, {live.ms} ms</Text>
            <Text style={s.mono}>board round {live.board.roundId.toString()}</Text>
            <Text style={s.mono}>
              board slots {live.board.startSlot.toString()} → {live.board.endSlot.toString()} (len {(live.board.endSlot - live.board.startSlot).toString()})
            </Text>
            <Text style={s.mono}>
              config round_slots {live.config.protocol.roundSlots.toString()}, intermission {live.config.protocol.intermissionSlots.toString()}
            </Text>
            <Text style={s.mono}>sample automation (public, decoded)</Text>
            <Text style={s.mono}>
              {'  '}balance {sol(live.sample.balance)} SOL, amount {live.sample.amount.toString()}, fee {live.sample.fee.toString()}
            </Text>
            <Text style={s.mono}>
              {'  '}strategy {live.sample.strategy.toString()}, mask {live.sample.mask.toString(2).replace(/0/g, '·').replace(/1/g, '■')}
            </Text>
            <Text style={s.mono}>
              {'  '}executor {live.sample.executor.toBase58().slice(0, 10)}…, reload {live.sample.reload.toString()}
            </Text>
            {account && (
              <>
                <Text style={s.mono}>your Automation: {live.walletAutomation ? `balance ${sol(live.walletAutomation.balance)} SOL` : 'none'}</Text>
                <Text style={s.mono}>
                  your Miner: {live.walletMiner ? `lifetime deployed ${sol(live.walletMiner.lifetimeDeployed)}, returned ${sol(live.walletMiner.lifetimeRewardsSol)} SOL` : 'none'}
                </Text>
              </>
            )}
          </View>
        )}

        <Text style={s.h}>3. On-device self-test {checks ? `(${passed}/${total} pass)` : '…'}</Text>
        {checks?.map((c) => (
          <Text key={c.name} style={c.ok ? s.ok : s.bad}>
            {c.ok ? 'PASS' : 'FAIL'} {c.name}
            {c.detail ? ` — ${c.detail}` : ''}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  pad: { padding: 16, gap: 6 },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  h: { fontSize: 16, fontWeight: '700', marginTop: 14, color: '#111' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#222' },
  ok: { fontFamily: 'monospace', fontSize: 12, color: '#0a6b2d' },
  bad: { fontFamily: 'monospace', fontSize: 12, color: '#b00020', fontWeight: '700' },
});
