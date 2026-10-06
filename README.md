# SHIFT

**Clock in once. ORE works your shift. Get paid at clock-out.**

SHIFT is an Android app for Solana Seeker phones (and any phone with a Mobile Wallet Adapter wallet) that turns [ORE](https://ore.com) mining into a simple daily ritual instead of a round-by-round grid game.

## What it does

1. **Clock in** – pick a role, a budget (the most you can lose is shown before you sign) and a length. One signature starts an ORE *automation* funded with that budget.
2. **The shift** – while you are away, a small executor service places each round's bet for you, only at the amount and squares you chose and only up to your budget.
3. **Payslip** – open the app any time to see what was played, what came back and your net result, rebuilt from on-chain data so it is correct even after the app was killed or reinstalled.
4. **Clock out** – one signature settles your last round, collects your rewards and closes the shift. A streak and a timesheet keep the habit going.

SHIFT never holds your keys: every signature happens in your wallet app.

## Status

**In development** for the **CLOCK IN** hackathon (Solana Mobile × Radiants). It runs on mainnet with small amounts, it is experimental, and parts are still being tested on real devices. Only use SOL you can afford to lose. The app caps a single shift at 0.5 SOL.

## Repository map

| Folder | What is in it |
|---|---|
| [`app/`](app) | The Expo / React Native Android app (screens, wallet service, shift planner, reconciler, payslip, streak). |
| [`packages/codec/`](packages/codec) | `@shift/codec`: ORE account decoders, instruction builders and the on-chain memo format, tested against real mainnet account dumps. |
| [`crank/`](crank) | The executor service that deploys each round for SHIFT automations (dry-run by default; Docker + Railway ready). |
| [`docs/`](docs) | Product requirements, ORE integration notes, trust model, device test checklists, runbooks. |
| [`scripts/`](scripts) | Read-only tools: fixture fetcher, mainnet simulation, payslip checker, liveness measurer, secret scanner. |

## Documentation

- [Trust model](docs/TRUST_MODEL.md): exactly what the executor can and cannot do, from the verified ORE program source.
- [Product requirements (PRD)](docs/PRD.md): the source of truth for features, acceptance criteria and edge cases.

## Build the APK (EAS)

You need Node 20+, an [Expo](https://expo.dev) account, and this repo cloned.

```bash
npm install                       # from the repo root (npm workspaces)
cd app
npx eas-cli@latest login
npx eas-cli@latest init           # links the project to YOUR Expo account
npx eas-cli@latest build --platform android --profile smoke
```

EAS builds in the cloud (no Android Studio needed) and prints a link to the APK. Build profiles are in [`app/eas.json`](app/eas.json). To run the tests: `npm test` from the repo root.

## Install on your phone (sideloading)

The APK is not from the Play Store, so Android's **Play Protect** may block it. This is expected for sideloaded apps:

1. Open the APK link on the phone and allow your browser to **install unknown apps** if asked.
2. If Play Protect warns about the app, tap **More details → Install anyway**.
3. You also need a wallet app that supports **Mobile Wallet Adapter** (the Seed Vault wallet on a Seeker, or another MWA wallet). Without one the app shows "No compatible wallet found".

## License

Not yet specified.
