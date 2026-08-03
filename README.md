<p align="center">
  <img src="frontend/public/chronos-logo.png" alt="CHRONOS logo" width="140" />
</p>

<h1 align="center">CHRONOS</h1>

<p align="center">
  <strong>Non-custodial, time-locked USDC savings and treasury infrastructure on Arc Testnet.</strong>
</p>

<p align="center">
  Lock USDC. Split vaults. Stream releases. Gate unlocks. Delegate mature claims. Verify reserves live.
</p>

<p align="center">
  <a href="https://chronosfinance.vercel.app">Live App</a>
  ·
  <a href="https://chronosfinance.vercel.app/features">Features</a>
  ·
  <a href="https://chronosfinance.vercel.app/docs">Docs</a>
  ·
  <a href="https://chronosfinance.vercel.app/proof-of-reserves">Proof of Reserves</a>
  ·
  <a href="https://chronos-backend-production.up.railway.app/health">Backend Health</a>
</p>

---

## Table of Contents

- [What CHRONOS Is](#what-chronos-is)
- [Why It Exists](#why-it-exists)
- [Live Deployment](#live-deployment)
- [Product Surface](#product-surface)
- [System Architecture](#system-architecture)
- [Repository Structure](#repository-structure)
- [Smart Contracts](#smart-contracts)
- [Backend Services](#backend-services)
- [Frontend Application](#frontend-application)
- [Critical User Flows](#critical-user-flows)
- [Proof of Reserves](#proof-of-reserves)
- [Agent Automation](#agent-automation)
- [Credit Lines](#credit-lines)
- [Scheduled Payments](#scheduled-payments)
- [CCTP Settlement](#cctp-settlement)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Verification](#verification)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Further Reading](#further-reading)

---

## What CHRONOS Is

CHRONOS is a full-stack testnet savings platform for Arc. It lets a user connect a wallet, lock
USDC into a time-based vault, track that vault through a dashboard, add more funds, claim at
maturity, optionally withdraw early from flexible vaults, and verify the reserve posture of the
system from public read-only endpoints.

The project is not just a frontend mock. The repo contains:

- Arc Testnet Solidity contracts for vaults, treasury, proof of reserves, scheduled payments,
  credit lines, bridge orchestration, CCTP receivers, governance timelock, and oracle adapters.
- An Express backend that handles auth, vault APIs, event indexing, bridge tracking, keeper jobs,
  proof-of-reserves reads, and agent automation.
- A Next.js frontend with public marketing/docs pages and wallet-gated dashboard workflows.
- Production deployment targets on Vercel and Railway.
- Smoke scripts and verification commands for contracts, frontend, backend, and live endpoints.

CHRONOS is currently scoped as a **testnet release**. It is built around real contract calls and
real infrastructure, but it should not be treated as an audited mainnet financial product.

## Why It Exists

Savings products usually fail users in one of two ways:

1. They are too soft: users can exit any time, so the product does not actually create discipline.
2. They are too custodial: users must trust an app, company, or database to represent balances
   correctly.

CHRONOS takes the opposite path:

- **Rules live in contracts.** A fixed vault cannot simply be bypassed in the UI.
- **Users keep wallet custody.** CHRONOS does not ask users to surrender keys.
- **Settlement is observable.** Vault lifecycle and proof-of-reserves flows are designed around
  on-chain state, not a database-only story.
- **Advanced behavior remains explicit.** Split vaults, streaming releases, oracle conditions,
  delegated claims, and credit lines are all modeled as separate primitives rather than hidden
  product magic.

## Live Deployment

| Surface | URL | Purpose |
| --- | --- | --- |
| Frontend | `https://chronosfinance.vercel.app` | Public app and dashboard |
| Features | `https://chronosfinance.vercel.app/features` | Product capability overview |
| Docs | `https://chronosfinance.vercel.app/docs` | User/operator documentation |
| Public reserves | `https://chronosfinance.vercel.app/proof-of-reserves` | Walletless reserves view |
| Backend health | `https://chronos-backend-production.up.railway.app/health` | Runtime service status |
| Agent status | `https://chronos-backend-production.up.railway.app/api/agent/status` | Keeper configuration/status |

Verified on 2026-08-03:

- Vercel frontend returned `200 OK`.
- Railway `/health` returned `200 OK`.
- Railway `/api/agent/status` returned `200 OK`.
- Backend health reported `eventListener`, `bridgeTracker`, `scheduledPaymentKeeper`, and
  `vaultAgentKeeper` running.

## Product Surface

### Public Pages

- `/` - Homepage and primary call to action.
- `/features` - Dedicated feature overview page.
- `/docs` - Detailed product, flow, and operations documentation.
- `/proof-of-reserves` - Public reserve transparency page.

### Wallet-Gated Dashboard

- `/dashboard` - Vault portfolio overview.
- `/dashboard/create-vault` - Guided vault creation flow.
- `/dashboard/[vaultId]` - Vault lifecycle, add-funds, claim, withdrawal, and detail view.
- `/dashboard/proof-of-reserves` - Authenticated dashboard reserves view.
- `/dashboard/activity` - User activity feed.
- `/dashboard/lend` - Credit-line workflow.
- `/dashboard/treasury-payments` - Treasury scheduled-payment workflow.
- `/dashboard/settings` - Wallet/account settings.

## System Architecture

At a high level, CHRONOS is a three-layer application:

```text
User wallet
  |
  | Privy session + signed wallet transactions
  v
Next.js frontend
  |
  | REST API, session token, vault actions, reserve reads
  v
Express backend on Railway
  |
  | Supabase, Arc RPC, source-chain RPCs, Circle Iris/CCTP, keeper jobs
  v
Arc Testnet contracts
```

Arc Testnet is the canonical settlement chain. Source chains are used for supported CCTP deposit
and claim routes, while vault state and reserve verification settle on Arc.

### Architecture Decisions

- **Arc as canonical state.** Vaults, reserves, credit lines, scheduled payments, and treasury
  primitives live on Arc Testnet.
- **CCTP for USDC movement.** USDC movement uses Circle CCTP V2 style burn-and-mint settlement.
- **Backend as coordinator, not custodian.** The backend tracks settlement, events, sessions, and
  keeper jobs. It should not be treated as the source of truth for funds.
- **Live reserves over DB-only accounting.** The live verification path calls the contract rather
  than trusting only Supabase aggregates.
- **Privy for wallet authentication.** The frontend uses Privy for wallet login/session UX while
  still relying on the user's wallet for transaction authority.
- **Webpack build path.** The frontend production build uses `next build --webpack`.

## Repository Structure

```text
.
├── backend/
│   ├── src/
│   │   ├── routes/              # REST API routes
│   │   ├── services/            # Vault, bridge, proof, agent, keeper services
│   │   ├── middleware/          # Auth and error handling
│   │   ├── config/              # Env, contracts, logger, database clients
│   │   └── server.js            # Express entrypoint
│   └── package.json
├── contracts/
│   ├── arc/                     # Arc Testnet Solidity contracts
│   ├── scripts/                 # Deployment and smoke scripts
│   ├── test/                    # Contract tests
│   └── hardhat.config.js
├── frontend/
│   ├── app/                     # Next.js App Router pages
│   ├── components/              # Layout and UI components
│   ├── config/                  # Chain and contract constants
│   ├── hooks/                   # Wallet/session hooks
│   ├── services/                # API and contract-facing frontend services
│   ├── store/                   # Zustand stores
│   ├── types/                   # Shared frontend types
│   └── public/chronos-logo.png
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ARCHITECTURE_DECISION.md
│   └── archive/
└── README.md
```

## Smart Contracts

Contracts live under `contracts/arc/`.

| Contract | Role |
| --- | --- |
| `TimeLockVault.sol` | Core vault engine: deposits, fixed/flexible claims, early withdrawal penalty, split buckets, streaming tranches, oracle/treasury conditions, credit-line collateral hooks, delegated claims |
| `VaultFactory.sol` | Vault creation entrypoint and registry/statistics |
| `BridgeOrchestrator.sol` | Coordinates inbound/outbound CCTP vault settlement |
| `CCTPReceiver.sol` | Source-chain receiver with processed-message replay guard |
| `ProofOfReserves.sol` | Live reserve verification against vault state |
| `Treasury.sol` | Protocol fee collection and USDC accounting |
| `CreditLine.sol` | USDC credit lines collateralized by locked vault balances |
| `ScheduledPayment.sol` | On-chain payment schedule guards, executed by backend keeper |
| `GovernanceTimelock.sol` | Delayed governance execution for privileged changes |
| `BandOracleAdapter.sol` | Adapter for real oracle-style price reads where configured |
| `MockPriceOracle.sol` | Demo/mock price oracle for controllable test scenarios |

### Arc Network Constants

| Concept | Value |
| --- | --- |
| Arc Testnet chain ID | `5042002` |
| Arc CCTP domain | `26` |
| Arc RPC | `https://rpc.testnet.arc.network` |
| Arc explorer | `https://testnet.arcscan.app` |
| Arc USDC interface | `0x3600000000000000000000000000000000000000` |
| CCTP TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

### Vault Modes

| Mode | Behavior |
| --- | --- |
| Fixed | Funds remain locked until unlock time. No early withdrawal path. |
| Flexible | Funds can be withdrawn early with a configured penalty; no penalty at maturity. |
| Split | A deposit is allocated across savings/yield/reserve-style buckets by basis points. |
| Streaming | Funds release over tranches instead of one all-or-nothing unlock. |
| Oracle-conditioned | Claim requires a configured oracle price condition in addition to time. |
| Treasury-conditioned | Claim requires a treasury balance condition in addition to time. |
| Delegated | Owner can authorize an agent address to trigger eligible claims without redirecting payout. |
| Collateralized | A vault can back a credit line and be locked/unlocked/liquidated through the CreditLine contract. |

## Backend Services

The backend is an Express app with Supabase/Postgres persistence and several long-running services.

| Service | File | Purpose |
| --- | --- | --- |
| Vault API | `backend/src/routes/vaults.js` | Create, list, read, add funds, claim, recover, and reconcile vaults |
| Auth API | `backend/src/routes/auth.js` | Privy-backed session flow and JWT handling |
| Bridge API | `backend/src/routes/bridge.js` | Bridge and CCTP helper endpoints |
| Proof API | `backend/src/routes/proofOfReserves.js` | Public reserve reads and live verification |
| Agent API | `backend/src/routes/agent.js` | Agent keeper status and delegated maintenance surface |
| Credit API | `backend/src/routes/creditLine.js` | Credit-line backend route |
| Scheduled payments API | `backend/src/routes/scheduledPayments.js` | Treasury scheduled-payment route |
| Event listener | `backend/src/services/eventListenerService.js` | Polls Arc events and updates read models |
| Bridge tracker | `backend/src/services/bridgeTrackerService.js` | Tracks CCTP attestation and settlement state |
| CCTP relay | `backend/src/services/cctpRelayService.js` | Fetches/verifies Circle attestations and submits receive calls |
| Vault agent | `backend/src/services/vaultAgentService.js` | Scans for eligible delegated vaults and triggers claims |
| Smart account agent | `backend/src/services/agentSmartAccountService.js` | ERC-4337/Pimlico sponsored execution path |
| Proof service | `backend/src/services/proofOfReservesService.js` | Aggregated and live reserve calculations |

## Frontend Application

The frontend is a Next.js App Router application.

| Area | Stack |
| --- | --- |
| Framework | Next.js 16 App Router |
| UI | React 18 + Tailwind CSS |
| Data fetching | React Query + Axios |
| Client state | Zustand |
| Wallet/auth | Privy + wallet provider |
| Contract calls | Viem |
| Charts/reserves | Recharts |

Design-wise, CHRONOS uses a restrained dark operations UI: high-contrast cards, compact dashboard
information, clear transaction stages, and bright primary actions for wallet/contract moments.

## Critical User Flows

### 1. Create Vault

```text
Connect wallet
  -> choose source chain
  -> choose amount and duration
  -> choose fixed/flexible vault type
  -> optionally configure condition/split/streaming behavior
  -> review terms
  -> approve spender if allowance is insufficient
  -> submit source-chain settlement
  -> backend tracks CCTP/Arc settlement
  -> vault detail page opens
```

The create flow is deliberately staged so users see when they are selecting product terms versus
when they are authorizing wallet actions.

### 2. Add Funds

```text
Open active vault
  -> choose add-funds action
  -> enter amount
  -> approve if needed
  -> submit source-chain transaction
  -> backend settles update
  -> lifecycle entry appears as Added Funds
```

Add-funds preserves the existing vault schedule and updates lifecycle accounting.

### 3. Claim at Maturity

```text
Open mature vault
  -> choose claim destination
  -> simulate claim
  -> sign transaction
  -> settle claim
  -> reconcile on-chain status
  -> UI shows claimed / zero locked balance
```

The app uses simulation before sending where possible so contract reverts are surfaced early.

### 4. Flexible Early Withdrawal

Flexible vaults support emergency withdrawal before maturity with a penalty. Fixed vaults are
intentionally stricter and should reject early withdrawal.

### 5. Recover Submitted Burn

If a wallet burn succeeds but backend settlement times out before a vault appears, the user can
recover by submitting the source-chain burn transaction hash in the recovery panel.

### 6. Delegate Agent

A vault owner can authorize the configured agent smart account as delegate. The delegate can trigger
eligible claims, but payout goes to the vault owner. The delegate cannot redirect user funds.

### 7. Credit Line

The lending area uses the configured CreditLine contract. A vault can be treated as collateral
through contract hooks that lock, unlock, or liquidate collateral according to CreditLine rules.

## Proof of Reserves

Proof of reserves has two surfaces:

| Endpoint/Page | Purpose |
| --- | --- |
| `/proof-of-reserves` | Public frontend page |
| `/dashboard/proof-of-reserves` | Dashboard reserves page |
| `GET /api/proof-of-reserves` | Aggregated/cached backend view |
| `GET /api/proof-of-reserves/verify` | Live on-chain verification path |

The live verification path calls `ProofOfReserves.verifyLiveReserves()` and does not rely solely on
database totals. This distinction matters: the database is useful for fast UI and history, but Arc
contract state is the authority for live reserve math.

## Agent Automation

The vault-maintenance agent is designed around bounded authority:

- The owner explicitly delegates a vault.
- The agent can trigger eligible claim execution.
- Payout remains bound to the vault owner.
- Delegate fees are handled by contract rules.
- The backend keeper scans for eligible delegated vaults.
- The production status endpoint reports whether the keeper is configured and running.

Production status:

```text
GET https://chronos-backend-production.up.railway.app/api/agent/status
```

Expected healthy shape:

```json
{
  "configured": true,
  "keeperRunning": true,
  "eligibleVaultCount": 0,
  "eligibleVaultIds": []
}
```

`eligibleVaultCount: 0` is normal when no delegated mature vaults are ready.

## Credit Lines

Credit lines extend vaults beyond simple savings. The idea is that locked value can back a USDC
credit line while contract hooks prevent collateral from being freely claimed during the loan.

Important moving parts:

- `CreditLine.sol` owns credit-line state.
- `TimeLockVault.sol` exposes collateral hooks callable by the configured CreditLine contract.
- The frontend lending page lives at `/dashboard/lend`.
- Frontend production configuration uses `NEXT_PUBLIC_CREDIT_LINE`.
- Backend route code lives in `backend/src/routes/creditLine.js`.

## Scheduled Payments

Scheduled payments are modeled with a contract plus an off-chain keeper:

- `ScheduledPayment.sol` stores payment schedules and enforces due-time and balance guards.
- The backend scheduled-payment keeper calls execution once a payment is due.
- The keeper cannot bypass on-chain rules, but it can delay execution if the backend is down.
- The dashboard page lives at `/dashboard/treasury-payments`.

This is intentionally documented as centralized keeper automation, not decentralized automation.

## CCTP Settlement

CHRONOS uses CCTP-style settlement for USDC movement between supported testnets and Arc.

Supported source/destination chain set in this repo:

- Ethereum Sepolia
- Base Sepolia
- Arbitrum Sepolia
- OP Sepolia
- Arc Testnet

The backend bridge path is designed around a state machine:

```text
PENDING_ATTESTATION
  -> ATTESTED
  -> RECEIVED_ON_ARC
  -> VAULT_CREATED
```

Before relaying, the backend verifies expected amount and recipient data where applicable. Circle's
MessageTransmitter still verifies the attestation at the protocol contract layer.

## Environment Variables

Do not commit secret values. Use the names below as the contract between local development,
Railway, Vercel, and scripts.

### Shared / Auth

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Backend JWT signing secret |
| `PRIVY_APP_ID` | Privy app identifier |
| `PRIVY_APP_SECRET` | Privy server secret; backend only |

### Circle / CCTP

| Variable | Purpose |
| --- | --- |
| `CIRCLE_API_KEY` | Circle API key |
| `CCTP_TOKEN_MESSENGER` | CCTP TokenMessenger contract |
| `CCTP_MESSAGE_TRANSMITTER` | CCTP MessageTransmitter contract |
| `*_CCTP_RECEIVER_ADDRESS` | Source-chain receiver addresses |

### Arc Contracts

| Variable | Purpose |
| --- | --- |
| `ARC_TESTNET_RPC` | Arc Testnet RPC URL |
| `ARC_CHAIN_ID` | Arc chain ID, `5042002` |
| `ARC_CCTP_DOMAIN` | Arc CCTP domain, `26` |
| `ARC_USDC` | Arc USDC interface |
| `ARC_TREASURY_ADDRESS` | Treasury contract |
| `ARC_GOVERNANCE_TIMELOCK_ADDRESS` | Governance timelock |
| `ARC_TIMELOCK_VAULT_ADDRESS` | TimeLockVault contract |
| `ARC_BRIDGE_ORCHESTRATOR_ADDRESS` | BridgeOrchestrator contract |
| `ARC_VAULT_FACTORY_ADDRESS` | VaultFactory contract |
| `ARC_PROOF_OF_RESERVES_ADDRESS` | ProofOfReserves contract |
| `ARC_CREDIT_LINE_ADDRESS` | CreditLine contract |
| `ARC_SCHEDULED_PAYMENT_ADDRESS` | ScheduledPayment contract |
| `ARC_MOCK_PRICE_ORACLE_ADDRESS` | Mock/demo oracle |
| `ARC_BAND_ORACLE_ADAPTER_ADDRESS` | Band oracle adapter |

### Backend

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase/Postgres connection string |
| `NODE_ENV` | Runtime environment |
| `PORT` | Backend port, usually `3001` locally |
| `SCHEDULED_PAYMENTS_ADMIN_KEY` | Server-side key for owner-gated scheduled-payment creation |

### Frontend

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Frontend API base URL |
| `NEXT_PUBLIC_TIMELOCK_VAULT` | Public TimeLockVault address |
| `NEXT_PUBLIC_CREDIT_LINE` | Public CreditLine address |
| `NEXT_PUBLIC_CIRCLE_APP_ID` | Circle user-controlled wallet app ID, if email onboarding is enabled |

Production frontend should use:

```text
NEXT_PUBLIC_API_URL=https://chronos-backend-production.up.railway.app
```

Local frontend normally uses:

```text
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Local Development

### Prerequisites

- Node.js compatible with the lockfiles.
- npm.
- A wallet with testnet support.
- Supabase/Postgres connection for backend persistence.
- RPC access for Arc Testnet and supported source testnets.
- Circle/Privy credentials for full live flows.

### 1. Contracts

```bash
cd contracts
npm install
npm run compile
```

Deploy scripts:

```bash
npm run deploy:arc
npm run deploy:base
npm run deploy:arbitrum
npm run deploy:ethereum
npm run deploy:op
```

### 2. Backend

```bash
cd backend
npm install
cp ../.env.example .env
npm run dev
```

Default local backend:

```text
http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/health
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default local frontend:

```text
http://localhost:3000
```

Production-style local build:

```bash
npm run type-check
npm run build
```

## Verification

### Frontend

```bash
cd frontend
npm ls --depth=0
npm run type-check
npm run build
```

Known non-fatal build warning:

```text
Module not found: Can't resolve '@farcaster/mini-app-solana'
```

This warning currently originates from Privy's optional Farcaster/Solana path and does not fail the
webpack build.

### Backend

```bash
cd backend
npm ls --depth=0
node --check src/server.js
npm test
```

### Contracts

The repo has Hardhat scripts for feature smoke testing. From `contracts/`:

```bash
npx hardhat run scripts/smoke-treasury.js
npx hardhat run scripts/smoke-proof-of-reserves.js
npx hardhat run scripts/smoke-split-vault.js
npx hardhat run scripts/smoke-credit-line.js
npx hardhat run scripts/smoke-oracle-unlock.js
npx hardhat run scripts/smoke-streaming-vault.js
npx hardhat run scripts/smoke-cctp-receiver.js
npx hardhat run scripts/smoke-scheduled-payment.js
npx hardhat run scripts/smoke-multichain-claim.js
npx hardhat run scripts/smoke-vault-delegate.js
```

### Live Smoke Checks

```bash
curl https://chronosfinance.vercel.app
curl https://chronosfinance.vercel.app/features
curl https://chronosfinance.vercel.app/docs
curl https://chronos-backend-production.up.railway.app/health
curl https://chronos-backend-production.up.railway.app/api/agent/status
```

## Deployment Notes

### Vercel

Frontend production is deployed from the Next.js app. Required production env values include:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_TIMELOCK_VAULT`
- `NEXT_PUBLIC_CREDIT_LINE`
- `NEXT_PUBLIC_CIRCLE_APP_ID` if the Circle email wallet path is enabled
- Privy public/client-side configuration values used by the frontend provider

### Railway

Backend production runs on Railway.

Runtime health endpoint:

```text
https://chronos-backend-production.up.railway.app/health
```

The health endpoint should show:

- `eventListener: running`
- `bridgeTracker: running`
- `scheduledPaymentKeeper: running`
- `vaultAgentKeeper: running`

### Git Branches

Recent docs/features work was pushed to both:

- `main`
- `hackathon-sprint`

When deploying, confirm which branch Vercel/Railway are tracking before assuming a pushed commit is
live.

## Troubleshooting

### Wallet is on the wrong chain

Error shape:

```text
Wallet is still on chain 5042002. Switch to Ethereum Sepolia (11155111) and retry.
```

Fix: switch the wallet to the chain named in the message and retry. CHRONOS validates the wallet
chain before signing transactions.

### Privy approval popup appears

Approval prompts happen when token allowance is not already sufficient for the spender and amount.
The app checks allowance to avoid unnecessary approvals, but a first-time spender or larger amount
can still require approval.

### Burn succeeded but no vault appears

Use the submitted-burn recovery panel on the create-vault confirmation step. Paste the source-chain
burn transaction hash so the backend can resume settlement.

### Claim simulation fails

If simulation says the vault is not active, refresh the vault detail page and confirm status. The
vault may already be claimed, may not be active, or may not satisfy time/condition requirements.

### Railway URL returns 404

Use the backend URL:

```text
https://chronos-backend-production.up.railway.app
```

The shorter `chronos-production.up.railway.app` URL is not the active backend.

## Known Limitations

These are current boundaries, not hidden release claims:

- CHRONOS is a testnet release and is not an audited mainnet custody/finance product.
- Scheduled payments rely on a centralized backend keeper. Contract guards limit what the keeper
  can do, but downtime can delay execution.
- Some oracle flows use mock/demo oracle configuration depending on environment.
- Circle email wallet onboarding requires correct Circle Console configuration, including app ID
  and email/SMTP setup.
- The Circle Developer-Controlled Wallet path exists as an alternative path but is not the primary
  sponsored agent claim path.
- Full wallet-based live testing still requires a real browser wallet, testnet USDC, and the
  correct chain selected by the user.
- Contract smoke scripts are the preferred contract verification path for this repo. Treat older
  archived docs as historical snapshots when they conflict with this README.

## Roadmap

High-value next improvements:

- Make docs versioned by deployment environment and contract address set.
- Add status badges from live health and reserves endpoints.
- Add guided UI for agent delegation with clearer eligibility explanations.
- Add richer lending docs once the credit-line UI is fully exercised by live users.
- Add browser E2E tests for `/features`, `/docs`, create-vault, add-funds, and claim flows.
- Replace any remaining demo oracle paths with verified production-grade oracle configuration when
  Arc support is finalized.
- Add monitoring/alerting documentation for Railway keeper failures and bridge settlement delays.
- Produce an operator runbook for deployment rollback, stuck settlement recovery, and key rotation.

## Further Reading

- [Architecture](./docs/ARCHITECTURE.md)
- [Architecture Decision Record](./docs/ARCHITECTURE_DECISION.md)
- [Contracts Test Coverage](./contracts/TEST_COVERAGE.md)
- [Contracts Testing Guide](./contracts/TESTING_GUIDE.md)
- [Archived build docs](./docs/archive/)

---

<p align="center">
  Built for disciplined testnet savings on Arc.
</p>
