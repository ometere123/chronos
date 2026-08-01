# CHRONOS

Time-locked USDC savings & vesting, plus treasury/lending infrastructure, on **Arc Testnet** via
Circle CCTP.

Lock USDC for a fixed or flexible term, split a deposit into savings/yield/reserve buckets, gate
an unlock on a price condition or a treasury balance, stream a deposit out over tranches, borrow
against a locked vault, and verify every claim of "fully reserved" against a live on-chain call —
not just a database.

## Table of contents

- [Pitch](#pitch)
- [Quickstart](#quickstart)
- [Architecture overview](#architecture-overview)
- [Deployed contracts](#deployed-contracts-arc-testnet)
- [Implemented features](#implemented-features)
- [Known limitations](#known-limitations)
- [Verifying the build](#verifying-the-build)

## Pitch

CHRONOS is savings-and-vesting infrastructure for USDC on Arc: time-locked vaults with real
penalty/discipline mechanics, a live proof-of-reserves check anyone can call without logging in,
and treasury-adjacent primitives (credit lines, scheduled payouts, multi-condition unlocks) built
on top of the same vault core. USDC moves onto Arc via Circle's CCTP V2, with attestation
verification and replay protection enforced both by Circle's own contracts and by an
application-level guard on top.

## Quickstart

### 1. Smart contracts

```bash
cd contracts
npm install
npx hardhat compile
# Run smoke tests against a local/forked node (see "Verifying the build" below) —
# `npx hardhat test` is currently broken under this Hardhat 3 setup; use the smoke scripts instead.
npx hardhat run scripts/smoke-treasury.js
```

### 2. Backend

```bash
cd backend
npm install
cp ../.env.example .env.local   # then fill in real values
npm run dev            # http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local      # then fill in real values
npm run dev            # http://localhost:3000
```

Proof of reserves is public at `http://localhost:3000/proof-of-reserves` — no wallet connection
required.

## Architecture overview

Arc Testnet is the canonical settlement chain: vault, treasury, proof-of-reserves, credit-line,
and governance contracts all live on Arc, and USDC arrives there via Circle CCTP V2 from Base
Sepolia, Arbitrum Sepolia, Ethereum Sepolia, or OP Sepolia. The backend indexes Arc events, tracks
CCTP attestations through a verified fetch → poll → verify → submit pipeline, and exposes a REST
API; the frontend is a Next.js dashboard gated behind an injected-wallet session, except for the
public proof-of-reserves page.

Full write-up, contract-by-contract responsibilities, the CCTP attestation state machine, and the
`TimeLockVault` feature surface (split vaults, oracle-gated unlocks, streaming, credit-line
collateral) live in **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Deployed contracts (Arc Testnet)

Addresses are populated post-deployment in each environment's `.env` file — no secrets or private
keys, just contract addresses. Env var names below match `.env.example`; see that file for the
current testnet values.

| Contract | Env var |
| --- | --- |
| Treasury | `ARC_TREASURY_ADDRESS` |
| GovernanceTimelock | `ARC_GOVERNANCE_TIMELOCK_ADDRESS` |
| TimeLockVault | `ARC_TIMELOCK_VAULT_ADDRESS` |
| BridgeOrchestrator | `ARC_BRIDGE_ORCHESTRATOR_ADDRESS` |
| VaultFactory | `ARC_VAULT_FACTORY_ADDRESS` |
| ProofOfReserves | `ARC_PROOF_OF_RESERVES_ADDRESS` |

| CreditLine | `ARC_CREDIT_LINE_ADDRESS` |
| ScheduledPayment | `ARC_SCHEDULED_PAYMENT_ADDRESS` |
| MockPriceOracle | `ARC_MOCK_PRICE_ORACLE_ADDRESS` |
| BandOracleAdapter | `ARC_BAND_ORACLE_ADAPTER_ADDRESS` |

All nine contracts above are live on Arc Testnet as of this writing (deployed via
`contracts/scripts/deploy-arc.js` and `contracts/scripts/deploy-band-oracle-adapter.js`). The
suite has been redeployed several times during development as contracts changed — the `.env.local`
values are always the current source of truth; addresses quoted in older docs/commit messages may
be stale.

Other relevant addresses/config: `ARC_USDC`, `ARC_CHAIN_ID` (`5042002`), `ARC_CCTP_DOMAIN` (`26`),
`CCTP_TOKEN_MESSENGER`, `CCTP_MESSAGE_TRANSMITTER`, and per-source-chain
`*_CCTP_RECEIVER_ADDRESS` variables. See `.env.example` for the full list.

## Implemented features

- **Treasury (USDC)** — protocol fee collection and multisig-controlled USDC accounting
  (`Treasury.sol`).
- **Live proof-of-reserves** — `GET /api/proof-of-reserves` (cached/aggregated) and
  `GET /api/proof-of-reserves/verify` (live on-chain call to
  `ProofOfReserves.verifyLiveReserves()`, bypassing the database). Both are public, read-only, and
  reachable without a wallet session — no auth middleware runs on either route.
- **Split / "Smart Treasury" vaults** — a single deposit auto-allocates into savings/yield/reserve
  buckets by basis points, each claimable independently (`TimeLockVault.depositFromBridgeSplit` /
  `claimBucket`).
- **Credit lines** — USDC credit lines collateralized by locked vault balances, with on-chain
  lock/unlock/liquidate hooks between `CreditLine.sol` and `TimeLockVault.sol`.
- **Oracle-gated unlock** — a vault claim can additionally require a price condition from a
  configured oracle. **`MockPriceOracle.sol` is a demo mock** — see Known Limitations.
- **Multi-condition unlock** — an oracle-price condition and a treasury-balance condition can both
  be attached to the same vault; both must pass before claim.
- **Streaming vaults** — a deposit can release over evenly-spaced tranches instead of a single
  unlock, claimable incrementally as tranches mature.
- **Hardened CCTP attestation w/ replay guard** — inbound and outbound CCTP transfers verify real
  Circle attestations (not a relayer shortcut) before submitting to Circle's own
  `MessageTransmitterV2`, plus an on-chain processed-message guard in `CCTPReceiver.sol` as
  defense-in-depth. See `docs/ARCHITECTURE.md` §4 for the full flow.
- **Scheduled payments** — `ScheduledPayment.sol` enforces due-timestamp, double-execution, and
  balance-threshold guards on-chain; a backend cron keeper triggers execution once due (see Known
  Limitations — this keeper is centralized).
- **Multi-chain destination bridging** — claims can target Base Sepolia, Arbitrum Sepolia,
  Ethereum Sepolia, or OP Sepolia as the outbound destination, not just the vault's original
  source chain.
- **Real oracle option (Band Protocol)** — `BandOracleAdapter.sol` wraps Band Protocol's live
  `StdReference` contract on Arc Testnet (`0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68`, verified
  on-chain returning a real USDC/USD rate), exposing the same `getPrice()` interface vaults expect.
  `MockPriceOracle.sol` remains available as a fallback for demo scenarios that need a controllable
  price.
- **Vault-maintenance agent (autonomous claim)** — a vault owner can call
  `TimeLockVault.setVaultDelegate(vaultId, agentAddress)` to authorize an address (the agent's
  ERC-4337 smart account) to trigger `claimVault()` on their behalf. Payout always goes to the
  vault owner; the delegate cannot redirect funds. `backend/src/services/vaultAgentService.js`
  scans for eligible delegated vaults and submits claims.
- **Gas-sponsored autonomous execution (Pimlico + ERC-4337)** — the agent's claim transactions
  are sponsored via Pimlico's real, live bundler + paymaster on Arc Testnet
  (`backend/src/services/agentSmartAccountService.js`, a standard ERC-4337 `SimpleAccount`). The
  owner key never needs Arc gas. **Verified with a full real end-to-end run against the live
  deployed contracts** (`contracts/scripts/e2e-agent-sponsored-claim.js`): created a real vault,
  owner delegated it to the agent, agent executed a genuinely gas-sponsored `claimVault()` —
  result `success: true`, tx
  [`0x3b22adc81a7d62e97807c1a0b7a29163cf2b6f40ee4b726fce7ba31869eb8a98`](https://testnet.arcscan.app/tx/0x3b22adc81a7d62e97807c1a0b7a29163cf2b6f40ee4b726fce7ba31869eb8a98),
  owner received 0.999 USDC, agent received 0.001 USDC, agent held zero USDC and zero gas the
  entire time.
- **Agent self-payment (on-chain fee split)** — when a delegate (not the owner) triggers a claim,
  `TimeLockVault.sol` automatically pays that delegate a small, owner-settable fee (`agentFeeBps`,
  default 0.10%, capped at 1%) out of the claimed amount, with the remainder going to the owner.
  Owner-triggered claims are unaffected — zero fee. Confirmed in the same real end-to-end run
  above (exact 0.10% fee paid to the agent).
- **Circle Developer-Controlled Wallet** — a real wallet, created and verified live on Arc Testnet
  via Circle's sandbox API (`backend/src/services/circleWalletService.js`). Kept as an
  alternative, non-sponsored claim path (`executeAgentClaimViaCircleWallet()`) — see known
  limitations.
- **Circle App Kit** — `backend/src/services/appKitBridgeService.js` uses Circle's real `AppKit`
  SDK (`kit.bridge()` / `kit.estimateBridge()`) to deposit USDC from a source chain into Arc.
  Verified live: `kit.getSupportedChains()` confirms Arc Testnet is registered with full CCTP v2
  config, and a real `estimateBridge()` call from Base Sepolia → Arc Testnet returned genuine fee
  figures. A read-only `GET /api/bridge/appkit/supported-chains` route is exposed; the
  estimate/execute functions require a private-key adapter and are not exposed over HTTP, since
  CHRONOS's real user flow uses browser-injected wallets (keys never touch the backend).

## Known limitations

Read before demoing or judging — these are real, current gaps, not hedging:

- **Scheduled payments use a centralized backend cron keeper**, not decentralized on-chain
  automation. `ScheduledPayment.sol` enforces all safety invariants on-chain (due time,
  double-execution, balance threshold), so the keeper cannot steal funds or bypass a guard — but it
  is a single off-chain process, and a hackathon-timeline tradeoff versus something like Chainlink
  Automation, which isn't confirmed available on Arc yet.
- **Chainlink price feeds are not confirmed live on Arc Testnet.** Research found real Chainlink
  CCIP infrastructure on Arc (router, RMN, LINK token) and a "Chainlink Scale" partnership
  announcement, but no verifiable Data Feeds/AggregatorV3 contract address. Band Protocol was used
  instead because it has one confirmed, on-chain-verified queryable address.
- **Circle Paymaster is not integrated and is not usable on Arc.** Confirmed absent from Arc on
  both Circle's marketing page and developer docs (supported chains: Arbitrum, Avalanche, Base,
  Ethereum, Optimism, Polygon PoS, Unichain — no Arc). Not attempted.
- **Circle Nanopayments is not integrated**, despite being confirmed real and live on Arc Testnet
  (via Circle's own `circlefin/arc-nanopayments` sample repo). Item 15 (agent self-payment) is
  instead implemented as a direct on-chain fee split in `TimeLockVault.claimVault()` — simpler,
  fully on-chain, and verified — rather than the off-chain x402/Gateway batching flow Nanopayments
  uses. Worth revisiting if a demo specifically wants to showcase Circle's Nanopayments product.
- **The agent's Circle Wallet is unfunded and is not the primary claim path.** It exists and is
  verified live on Arc Testnet, but `executeAgentClaimViaCircleWallet()` needs the wallet to hold
  its own Arc gas, which it does not. The primary claim path (`executeAgentClaim()`, via the
  ERC-4337 smart account + Pimlico paymaster) does not have this limitation and has been verified
  end-to-end — see "Gas-sponsored autonomous execution" above.
- **The agent's smart account owner key is a single, unshared key.** It's deliberately generated
  fresh and never funded (that's the point — Pimlico sponsors its gas), but it's still a single
  point of failure for the agent's ability to act. Production hardening would mean rotating it out
  of a plain env var into a proper key-management setup.
- **`npx hardhat test` is currently broken** under this repo's Hardhat 3 setup. Contract behavior
  is instead verified via 10 standalone smoke scripts in `contracts/scripts/smoke-*.js`, run with
  `npx hardhat run scripts/smoke-X.js`. See "Verifying the build" below.

## Verifying the build

There is no hosted demo environment in this repo checkout. To verify contract behavior locally,
run each smoke script from `contracts/`:

```bash
cd contracts
npx hardhat run scripts/smoke-treasury.js
npx hardhat run scripts/smoke-proof-of-reserves.js
npx hardhat run scripts/smoke-split-vault.js
npx hardhat run scripts/smoke-credit-line.js
npx hardhat run scripts/smoke-oracle-unlock.js
npx hardhat run scripts/smoke-streaming-vault.js
npx hardhat run scripts/smoke-cctp-receiver.js
npx hardhat run scripts/smoke-scheduled-payment.js
npx hardhat run scripts/smoke-multichain-claim.js
```

Each script deploys the relevant contracts to an ephemeral local Hardhat network and exercises the
feature end to end, printing pass/fail as it goes.

## Further reading

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — full architecture, contract responsibilities,
  CCTP attestation flow, `TimeLockVault` feature surface.
- [docs/archive/](./docs/archive/) — earlier build-status and testing-strategy documents, kept for
  history. Numbers in those files (test counts, coverage %, completion %) are historical snapshots
  and are **not** re-verified current claims; treat this README and `docs/ARCHITECTURE.md` as the
  source of truth.
