# Deploy the SHIFT crank on Railway (step by step)

You do not need Docker, a terminal on a server, or any build/start commands. The repo already contains a `Dockerfile` (`crank/Dockerfile`) and a `railway.json` that tell Railway exactly how to build and run it. We checked on 2026-10-06 that this image builds, starts as a non-root user, serves `/health`, defaults to dry-run, and refuses to start in live mode unless both safety switches are set.

**The plan:** deploy in **dry-run** first (it only needs your executor's *public* key, so no secret goes anywhere), prove it works, and only at "go live" paste the secret. Dry-run cannot send a transaction, by design and by test.

> Railway's screens change from time to time. The names below (Variables, Settings, Networking, Deployments) have been stable; if a label looks slightly different, look for the closest one.

---

## 0. Before you start (10 minutes)

1. **A GitHub account** and the repo pushed to it. Railway builds from GitHub.
   - First run the secret scan (it must say CLEAN): `node scripts/secret-scan.mjs`
   - Create an empty repo on github.com (name it e.g. `shift`; **private** is fine for now, Railway can deploy private repos; the hackathon needs it public at submission).
   - In PowerShell from the repo folder:
     ```powershell
     git remote add origin https://github.com/<your-user>/shift.git
     git push -u origin main
     ```
   - **Never** commit `executor.json` or any `.env` file. `.gitignore` already blocks them and the scan checks every commit.
2. **An RPC URL that is not the public one.** The free public Solana RPC rate-limits the kind of query the crank makes. Make a free account at an RPC provider (for example Helius or QuickNode), create a **mainnet** endpoint, and copy its HTTPS URL. It contains your API key: treat it like a password.
3. Your executor **public key** (`F5YFzE8dREtinnGxzTvjQVmSfS7gDgbDPfKZUYym4Ucm`) and the executor funded with about **0.03 SOL**.

## 1. Create the Railway project

1. Go to **railway.com** and sign up with GitHub. A trial or the Hobby plan (about $5/month) is enough: the crank is tiny.
2. **New Project → Deploy from GitHub repo** → authorise Railway on GitHub (allow access to just the `shift` repo) → pick the repo.
3. Railway starts a build straight away. **The first deploy will show "Crashed" or "Failed". That is expected**: no settings exist yet, and the crank refuses to start without them (you will see `config_error` in the logs). Do not worry; we fix it in step 2.

### Check the build settings (once)
Click the service → **Settings**:
- **Root Directory:** leave **empty** (the repo root). Important: the Dockerfile needs the whole repo as context.
- **Build:** it should say it uses a **Dockerfile** at `crank/Dockerfile` (that comes from `railway.json`). You do not type a build command or a start command.
- **Healthcheck path:** `/health` (also from `railway.json`).

## 2. Set the variables (dry-run)

Service → **Variables** → add these, one by one (or use **Raw Editor** and paste the block):

| Name | Value | Notes |
|---|---|---|
| `RPC_URL` | your RPC provider's mainnet HTTPS URL | secret-ish: it holds your API key |
| `EXECUTOR_PUBKEY` | `F5YFzE8dREtinnGxzTvjQVmSfS7gDgbDPfKZUYym4Ucm` | public, safe |
| `DRY_RUN` | `1` | simulate only |
| `PORT` | `8080` | the port the health page listens on |

Optional (leave out unless asked): `PRIORITY_FEE_MICROLAMPORTS` (default 1000), `POLL_MS` (default 2000).

Railway then shows a banner like "**N changes to apply**". Click **Deploy**. Do **not** add `EXECUTOR_KEYPAIR` yet.

## 3. Open the health page in your browser

1. Service → **Settings → Networking → Generate Domain**. If it asks for the port, enter **8080**. You get an address like `https://shift-crank-production-xxxx.up.railway.app`.
2. Open `https://<that address>/health` in any browser (phone works too).
3. You should see something like:
   ```
   {"ok":true,"mode":"DRY_RUN","crankPubkey":"F5YF…m4Ucm","activeAutomations":0,
    "solBalance":0.03,"lowBalance":false,"roundStalled":false, ...}
   ```
   Check these four things:
   - `"mode":"DRY_RUN"` (it must **not** say LIVE yet);
   - `"crankPubkey"` starts `F5YF` and ends `m4Ucm` (your key);
   - `"ok":true`;
   - `"solBalance"` is about `0.03` and `"lowBalance"` is `false` (the alert is below 0.01 SOL).
4. **Logs:** service → **Deployments** → click the latest → **View Logs**. You should see `starting_DRY_RUN` then `dry_run_notice` ("Simulating only… No secret key is loaded."). A line `low_executor_balance` means the executor needs funding.

If this works, the deployment is proven and still harmless. Send me the `/health` text.

## 4. Going live (ONLY after you have told me "go live" in our chat)

Do this at the moment the plan says so (see `docs/GO_LIVE_PLAN.md`), not before.

1. **Copy the secret without showing it.** In PowerShell:
   ```powershell
   Get-Content "$HOME\shift-secrets\executor.json" -Raw | Set-Clipboard
   ```
2. In Railway → Variables → **New Variable**: name `EXECUTOR_KEYPAIR`, paste the value (it looks like `[12,34,56,…]`, one long line). If the variable's **⋯ menu** offers **Seal**, use it so the value can never be displayed again (I could not check this screen from here; Railway variables are hidden by default and the crank never logs them either way). Do not paste it anywhere else, and **do not send it to me**.
3. **Clear the clipboard:** `Set-Clipboard -Value ""`. Also clear Windows clipboard history (press `Win + V` → Clear all), because Windows may keep a copy.
4. Add `ACKNOWLEDGE_LIVE` with the exact value `I-ACCEPT-MAINNET-TRANSACTIONS`.
5. Change `DRY_RUN` from `1` to `0`.
6. Leave `EXECUTOR_PUBKEY` as it is. It acts as a safety check: if it does not match the secret, the crank refuses to start.
7. Click **Deploy**. Wait about a minute, then open `/health`: it must now say `"mode":"LIVE"`. Logs show `starting_LIVE`.
8. Tell me; I will tell you what to look for next.

> The crank will never start live by accident: `DRY_RUN=0` without `ACKNOWLEDGE_LIVE` makes it exit with an error, and `DRY_RUN` missing or `1` means simulate-only.

## 5. Stopping it (any time)

- **Back to harmless mode (recommended):** Variables → set `DRY_RUN` back to `1`, delete `ACKNOWLEDGE_LIVE` and `EXECUTOR_KEYPAIR` → **Deploy**. `/health` shows `DRY_RUN` again. (If `DRY_RUN` were missing altogether it would also default to dry-run.)
- **Hard stop:** Deployments → the active deployment → **⋯ → Remove** (or Settings → delete the service).
- **Your money is never trapped by the crank stopping.** Budget sits in your ORE automation; on the phone, **End shift & withdraw** works without the crank.

## 6. Restart test (needed for AC-4.3)
Deployments → the active deployment → **⋯ → Restart** (or Redeploy). Watch the logs: within about one round (~80 seconds) you should see `round_worked` again. There is nothing to restore: the crank keeps no state.

## 7. If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| Logs: `config_error … Set EXECUTOR_PUBKEY…` | a variable is missing | add `EXECUTOR_PUBKEY` |
| Logs: `config_error … RPC_URL is required` | `RPC_URL` missing or not `https://…` | fix the value |
| Logs: `config_error … Refusing to start in LIVE mode` | `DRY_RUN=0` without `ACKNOWLEDGE_LIVE` | add it exactly, or set `DRY_RUN=1` |
| Logs: `config_error … EXECUTOR_KEYPAIR is not a valid…` | the pasted secret got cut or altered | copy again from the file with the command above |
| Logs: `config_error … does not match` | `EXECUTOR_PUBKEY` is not the public half of that secret | one of them is the wrong key |
| Browser: "Application failed to respond" | health page port mismatch | set `PORT=8080` and generate the domain with port 8080 |
| `/health` shows `"ok":false` | the loop is failing (usually the RPC) | check the RPC URL / provider limits; see the `tick_failed` logs |
| `"lowBalance":true` | executor under 0.01 SOL | send it ~0.03 SOL |
| `"roundStalled":true` | nobody has advanced ORE's round for 4 minutes | not our fault: ORE's own bots reset rounds; wait and watch |
| Logs full of `batch_simulated_ok` every ~12 s | normal in dry-run: it keeps re-checking, since nothing is deployed | none |

## 8. Cost and what is running
One small always-on container (roughly a few dollars a month). It makes about two RPC calls per second at most. The executor wallet spends about 0.000005 SOL per transaction (about 0.0002 SOL per hour for one user).

## Alternative without GitHub (not recommended)
Railway has a command-line tool (`npm i -g @railway/cli`, `railway login`, `railway init`, `railway up`) that uploads the folder directly. The GitHub route above is simpler and is what the hackathon needs anyway.
