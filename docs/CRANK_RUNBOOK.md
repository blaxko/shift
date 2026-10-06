# Crank runbook (F4)

The crank is a small Node service that, every round, deploys and checkpoints for SHIFT automations. **It is dry-run by default: it simulates and logs, never sends, and does not need your secret key.** Going live is a separate, explicit step that only happens when you say "go live".

## 1. Create the executor key (you run this, once)

From the repo root, in PowerShell:

```powershell
node scripts/gen-executor-key.mjs
```

- It writes the secret to `C:\Users\<you>\shift-secrets\executor.json` (outside the repo), refuses to overwrite an existing file, and prints **only** the public key and that path.
- Back the file up somewhere safe. It is the only copy. Never commit it, paste it, or send it to anyone, including Claude.
- Send me the **public key** only. I put it in `app/eas.json` as `EXPO_PUBLIC_CRANK_PUBKEY` and commit.
- Only if you will host the crank on Railway and need the secret as an env var: `node scripts/gen-executor-key.mjs --print-secret-for-env` also prints the base58 secret. It is off by default; use it once, copy straight into Railway's variable, then clear the terminal.
- Fund the **public key** with about 0.03 SOL for fees. A crank transaction costs about 0.000005 SOL, so that lasts for thousands of rounds; `/health` and the logs flag `lowBalance` below **0.01 SOL** (E-10).

## 2. Dry-run locally (safe; needs only the public key)

```powershell
$env:RPC_URL = "<your RPC url>"
$env:EXECUTOR_PUBKEY = "<executor public key>"
$env:DRY_RUN = "1"
npm run crank:dry
```

In another terminal: `curl http://127.0.0.1:8080/health`

What to expect in the logs (JSON lines):
- `starting_DRY_RUN` then `dry_run_notice` ("Simulating only… No secret key is loaded").
- With no SHIFT automation yet: no `round_worked` lines (nothing to do), `activeAutomations: 0` in `/health`.
- With a SHIFT automation: `round_worked` with `mode: DRY_RUN`, `batch_simulated_ok` with the compute units. **No transaction is ever sent.**
- `/health` fields: `ok`, `mode`, `crankPubkey`, `lastRoundId`, `lastRoundDeployedAt` (in dry-run this means "would have deployed"), `activeAutomations`, `slotLag`, `solBalance`, `lowBalance`, `roundStalled`, `lastBoardAdvanceAt`.

### AC-4.4 (the check that matters)
After your S-3 clock-in has created a SHIFT automation: run the dry-run above with the executor public key you used in the app. Expected: within one round a `batch_simulated_ok` for your wallet (a Deploy, preceded by a Checkpoint when needed). That is "successful simulation against mainnet for a live test automation". Send me the log lines.

## 3. Safety locks (verified by tests)
- `DRY_RUN` unset or `1` -> simulate only.
- `DRY_RUN=0` **alone** -> the process refuses to start (exit 2).
- Live needs **both** `DRY_RUN=0` and `ACKNOWLEDGE_LIVE=I-ACCEPT-MAINNET-TRANSACTIONS`, plus `EXECUTOR_KEYPAIR`.
- In dry-run the secret key is not loaded even if you provide it.
- Every transaction is checked by `assertCrankInstructions` before it is built: ORE Deploy/Checkpoint (+ ComputeBudget) only, executor the only signer.

## 4. Go live (ONLY after you say "go live" in the session)
Checklist, in order:
1. S-3 passed on device; AC-4.4 dry-run showed `batch_simulated_ok` for a real SHIFT automation.
2. Executor funded (about 0.03 SOL; the low-balance alert is at 0.01 SOL).
3. Decide where it runs. Locally: set `DRY_RUN=0`, `ACKNOWLEDGE_LIVE=I-ACCEPT-MAINNET-TRANSACTIONS`, `EXECUTOR_KEYPAIR=<secret>` (from your file) in that terminal only. Railway: set the same three variables in the service settings.
4. Start it and watch for `starting_LIVE`, then `batch_sent` lines with signatures. Check one signature on an explorer.
5. **Stop = unset `DRY_RUN`/`ACKNOWLEDGE_LIVE` (or set `DRY_RUN=1`) and restart, or stop the process.** Users' funds are never at risk from the crank stopping: they stay in the ORE program and the app's "End shift & withdraw" works without it.

## 5. Railway
Full step-by-step for a non-expert: **`docs/RAILWAY_RUNBOOK.md`**. The Docker image (`crank/Dockerfile`) was built and run on 2026-10-06: it starts as a non-root user, serves `/health`, defaults to dry-run and refuses unsafe live config (exit 2). Railway builds it for you from `railway.json`; you type no build or start commands.

The go-live order and what you do on the phone is in **`docs/GO_LIVE_PLAN.md`**.

## 6. Tests to run with the crank live (later)
- **AC-4.1/4.3** 30-minute liveness test: deploy rate >= 98 % of rounds; kill and restart the process, deploys resume within one round.
- **AC-4.6** end-of-shift run-down: run a tiny shift to zero and check no rent error, ORE auto-close, balance + rent returned, app shows Complete.
