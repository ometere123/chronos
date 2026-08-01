# CHRONOS Architecture

This document consolidates the original architecture decision record with everything built
since: Treasury accounting, credit lines, oracle-gated and multi-condition unlocks, streaming
vaults, split vaults, hardened CCTP attestation handling, scheduled payments, and multi-chain
destination bridging. It is the current, accurate description of the system — not a historical
log.

## 1. Canonical settlement chain

CHRONOS keeps **Arc Testnet** as the canonical settlement chain. Vault, treasury,
proof-of-reserves, credit-line, and governance contracts live on Arc. Source-chain contracts are
kept minimal (CCTP receivers only) rather than duplicating vault logic across chains.

The first launch focuses on **USDC over Circle CCTP V2**. Arbitrary ERC-20 bridging is a later
milestone, gated on each token having a verified cross-chain representation.

### Network constants

| Concept | Value |
| --- | --- |
| Arc Testnet EVM chain ID | `5042002` |
| Arc Testnet CCTP domain | `26` |
| Arc Testnet RPC | `https://rpc.testnet.arc.network` |
| Arc Testnet explorer | `https://testnet.arcscan.app` |
| Arc USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` |
| CCTP V2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

Chain identifiers are stored as `uint32` or larger everywhere in the contracts — `uint8` cannot
represent real EVM chain IDs such as Base Sepolia (`84532`), Arbitrum Sepolia (`421614`), Ethereum
Sepolia (`11155111`), or Arc Testnet (`5042002`). Bridge protocol is a separate small enum from
chain ID / CCTP domain.

## 2. Contracts (`contracts/arc/`)

| Contract | Responsibility |
| --- | --- |
| `Treasury.sol` | Protocol fee collection, multisig withdrawal, USDC accounting |
| `GovernanceTimelock.sol` | 7-day delayed upgrade execution for owner-controlled changes |
| `TimeLockVault.sol` | Core vault logic: deposits, claims, flexible withdrawal + penalty, split "smart" vaults, oracle-gated/treasury-guard unlock conditions, streaming/tranche release, credit-line collateral lock/liquidate |
| `VaultFactory.sol` | Vault creation entrypoint and registry/statistics |
| `BridgeOrchestrator.sol` | CCTP coordination for inbound/outbound bridging |
| `ProofOfReserves.sol` | On-chain, real-time reserve verification (`verifyLiveReserves()`) |
| `CCTPReceiver.sol` | Source-chain CCTP receiver, replay-guarded |
| `CreditLine.sol` | USDC credit lines collateralized by locked vault balances |
| `MockPriceOracle.sol` | **Demo mock** price feed used to exercise oracle-gated unlocks. Not a real Arc oracle — see Known Limitations. |
| `ScheduledPayment.sol` | On-chain payment schedule with due-timestamp, double-execution, and balance-threshold guards; executed by an off-chain keeper |

### 2.1 TimeLockVault feature surface

`TimeLockVault.sol` is the core contract and has grown several optional, backward-compatible
capabilities on top of the original fixed/flexible vault:

- **Split ("Smart Treasury") vaults** — `depositFromBridgeSplit()` allocates a single deposit into
  three buckets (savings/yield/reserve) by basis points that must sum to 10000. Each bucket is
  claimed independently via `claimBucket()` once the parent vault matures.
- **Oracle-gated unlock** — `depositFromBridgeAdvanced()` accepts an optional `conditionOracle` +
  `conditionThreshold` + `conditionAbove`. If set, `claimVault()` / `claimBucket()` /
  `claimStreamingTranches()` additionally require the oracle price to satisfy the threshold
  (`_extraConditionsMet()`), on top of the time lock.
- **Treasury-balance-guard condition** — a second, independent optional condition: the claim also
  requires a configured treasury contract's USDC balance to be above a threshold
  (`treasuryBalanceCheck` / `treasuryBalanceThreshold`).
- **Multi-condition unlock** — the oracle condition and the treasury-balance condition can both be
  set on the same vault; both must pass (`_extraConditionsMet` requires all enabled conditions).
- **Streaming vaults** — `numTranches` + `intervalSeconds` split a deposit into evenly-spaced
  release tranches; `maturedTrancheCount()` and `claimStreamingTranches()` let the owner claim
  whatever tranches have matured, any number of times, instead of a single all-or-nothing unlock.
- **Credit-line collateral** — `lockVaultCollateral()` / `unlockVaultCollateral()` /
  `liquidateVaultCollateral()` are called only by the configured `CreditLine` contract, so a vault
  can back a loan and be force-claimed to the CreditLine on liquidation without the vault owner's
  cooperation.

All of the above are opt-in: a vault created through the original `depositFromBridge()` path (no
conditions, no split, no streaming) behaves exactly as the original fixed/flexible vault.

## 3. Backend (`backend/`)

Express.js + Supabase(Postgres). Responsibilities:

- REST API for vault CRUD, bridge status, proof-of-reserves, users, auth (wallet-session JWT).
- **Event listener service** — polls Arc for `VaultCreated` / `VaultClaimed` / bridge-completion
  events every ~12s, with reorg-safe re-scanning.
- **Bridge tracker service** — polls Circle's Iris API for CCTP attestations and drives the
  bridge state machine (see §4).
- **Scheduled payment service** — a centralized cron-style keeper that calls
  `ScheduledPayment.sol`'s execute function once a payment is due (see Known Limitations in the
  README — this is not decentralized automation).
- **Proof of reserves service** — computes/caches the DB-aggregated view; the live on-chain check
  bypasses this entirely (see §5).

## 4. CCTP attestation flow (hardened)

Inbound and outbound CCTP transfers are settled with real Circle attestations, not a
relayer-trusted shortcut. Implemented in `backend/src/services/cctpRelayService.js` and
`backend/src/services/bridgeTrackerService.js`:

1. **Fetch.** `cctpRelayService.fetchMessage(sourceDomain, txHash)` calls Circle's Iris API
   (`GET https://iris-api-sandbox.circle.com/v2/messages/{sourceDomainId}?transactionHash={txHash}`)
   and returns the decoded message record (`status`, `message`, `attestation`).
2. **Poll with backoff.** `waitForAttestation()` polls until `status === "complete"` and both
   `message` and `attestation` are present, or a timeout elapses. A not-yet-ready attestation
   returns `PENDING_ATTESTATION` rather than erroring.
3. **Verify before relaying.** `finalizeBurnAndMint()` decodes the CCTP message body and checks
   the mint recipient and amount against what the backend expects *before* submitting anything. A
   mismatch is a hard failure (`RECIPIENT_MISMATCH`), never a silent pass-through.
4. **Submit the real receiveMessage call.** The verified `(message, attestation)` pair is sent to
   the canonical CCTP `MessageTransmitterV2.receiveMessage(message, attestation)` on the
   destination chain (Arc for inbound, the chosen destination chain for outbound claims). This is
   Circle's own contract — it independently verifies the attestation signature and enforces its
   own nonce-based replay protection.
5. **State machine + replay guard.** `bridge_transactions.bridge_state` persists progress through
   `PENDING_ATTESTATION -> ATTESTED -> RECEIVED_ON_ARC -> VAULT_CREATED` (see
   `backend/src/db/schema.sql`), so a mid-flow backend crash resumes exactly where it left off.
   `CCTPReceiver.processedMessages` additionally tracks processed CCTP message hashes on-chain and
   rejects replays and calls from any address other than the configured MessageTransmitter, as a
   defense-in-depth layer on top of Circle's own replay guard.

## 5. Proof of reserves

Two independent read paths, both public/read-only:

- `GET /api/proof-of-reserves` — database-aggregated view (fast, cached, includes by-chain/by-token
  breakdowns and history).
- `GET /api/proof-of-reserves/verify` — **live on-chain** check. Calls
  `ProofOfReserves.verifyLiveReserves()` directly, which recomputes the sum of active vault
  balances straight from `TimeLockVault` storage (not `VaultFactory` counters), bypassing the
  database entirely. Safe to call live during a demo.

Neither endpoint requires authentication — proof of reserves is meant to be independently
verifiable by anyone, not just logged-in users. The frontend page at `/proof-of-reserves` (public
route, outside the wallet-gated `/dashboard` layout) renders the database-aggregated view; the
same data is also reachable at `/dashboard/proof-of-reserves` for signed-in users navigating from
the sidebar.

## 6. Multi-chain destination bridging

Claims on a vault can target any configured destination chain, not just the source chain the
deposit came from. `BridgeOrchestrator` + the backend's bridge tracker route outbound CCTP burns
to Base Sepolia, Arbitrum Sepolia, Ethereum Sepolia, or OP Sepolia based on the vault's requested
destination, going through the same fetch → poll → verify → submit flow described in §4.

## 7. Scheduled payments

`ScheduledPayment.sol` stores payment schedules (recipient, amount, interval, due timestamp) with
on-chain guards: a payment cannot execute before its due timestamp, cannot be double-executed, and
cannot execute if it would drop the contract's USDC balance below a configured threshold. The
off-chain keeper (`backend/src/services/scheduledPaymentService.js`, a cron-style poller) calls the
execute function once a payment is due. Because the safety checks live on-chain, the keeper can
delay a payment (by being down) but cannot steal funds or bypass a guard — see Known Limitations
for why this keeper is centralized today.

## 8. Frontend (`frontend/`)

Next.js 14 App Router + React 18 + Tailwind + Zustand + React Query. Wallet auth is an injected
browser wallet (no embedded/custodial wallet). `/dashboard/*` routes are gated by
`app/dashboard/layout.tsx`, which redirects to `/` if no wallet is connected; `/` and
`/proof-of-reserves` are public.

## 9. Open implementation risks

- Proof-of-reserves must (and does, via `verifyLiveReserves()`) read actual on-chain vault token
  balances rather than trusting database-only totals for anything demo-critical.
- Arbitrary-token support requires a confirmed Arc route before any implementation promise.
- Scheduled payment execution relies on a single centralized backend cron keeper since no on-chain
  keeper network is confirmed live on Arc Testnet yet.
- Oracle-gated unlocks use `MockPriceOracle.sol`; a real Arc-native oracle integration is not yet
  confirmed available and remains a follow-up.

## References

- Arc network setup: https://docs.arc.network/arc/references/connect-to-arc
- Arc contract addresses and CCTP domain: https://docs.arc.network/arc/references/contract-addresses
- Arc App Kit supported bridge tokens/chains: https://docs.arc.network/app-kit/references/supported-blockchains
- Circle CCTP contract addresses: https://developers.circle.com/stablecoins/evm-smart-contracts
- Circle CCTP domains: https://developers.circle.com/stablecoins/supported-domains
