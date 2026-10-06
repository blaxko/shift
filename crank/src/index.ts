// SHIFT executor service. DRY-RUN BY DEFAULT: it simulates and logs, it never sends, and it never needs the secret key.
// Live mode requires DRY_RUN=0 AND ACKNOWLEDGE_LIVE=<exact string> (config.ts) — only on the user's explicit "go live".
import { Connection } from '@solana/web3.js';
import { rpcChain } from './chain';
import { ConfigError, describeConfig, parseConfig } from './config';
import { HealthState, startHealthServer } from './health';
import { consoleLogger } from './log';
import { createCrank } from './loop';
import { DryRunSubmitter, LiveSubmitter, type RpcLike } from './submit';

async function main() {
  const log = consoleLogger();
  let cfg;
  try {
    cfg = parseConfig(process.env);
  } catch (e) {
    // Only the message of OUR ConfigError is printed; it never contains key material.
    log.error('config_error', { message: e instanceof ConfigError ? e.message : 'invalid configuration' });
    process.exit(2);
  }

  const connection = new Connection(cfg.rpcUrl, 'confirmed');
  const rpc = connection as unknown as RpcLike;
  const submitter = cfg.live && cfg.keypair ? new LiveSubmitter(rpc, cfg.keypair, log) : new DryRunSubmitter(rpc, cfg.executorPubkey);
  const health = new HealthState(cfg.executorPubkey, cfg.live, cfg.lowBalanceLamports, cfg.pollMs);
  const server = startHealthServer(health, cfg.port);

  log.info(cfg.live ? 'starting_LIVE' : 'starting_DRY_RUN', describeConfig(cfg));
  if (!cfg.live) log.info('dry_run_notice', { message: 'Simulating only. No transaction will be sent. No secret key is loaded.' });

  const signal = { aborted: false };
  const stop = () => {
    signal.aborted = true;
    server.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const crank = createCrank(cfg, {
    chain: rpcChain(connection, log),
    submitter,
    health,
    log,
    nowUnix: () => Math.floor(Date.now() / 1000),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await crank.run(signal);
  log.info('stopped');
}

void main();
