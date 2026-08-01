# CHRONOS Architecture Decision

Date: 2026-05-12

## Decision

CHRONOS should keep Arc Testnet as the canonical settlement chain for the first testnet launch. The vault, treasury, proof-of-reserves, and governance contracts should live on Arc. Source-chain contracts should be avoided unless a bridge integration strictly requires a minimal adapter.

The first launch should focus on USDC over Circle CCTP V2. Arbitrary ERC-20 bridging should be treated as a later milestone after the USDC path is production-quality on testnet.

## Why

- Arc docs list Arc Testnet EVM chain ID as `5042002`, RPC as `https://rpc.testnet.arc.network`, and explorer as `https://testnet.arcscan.app`.
- Arc docs list Arc's Circle CCTP domain as `26`. This is not the EVM chain ID.
- Arc App Kit bridge support is USDC-only.
- Multi-network vault state would make ownership, reserves, claims, and failure recovery much harder. The product's core promise is time-locked settlement, so vault state should be canonical and simple.

## Launch Scope

Phase 1: Arc-only USDC vaults.

- Deploy vault core on Arc.
- Let users create, add, withdraw flexible, and claim on Arc.
- Prove fixed and flexible vault semantics before bridge complexity.

Phase 2: CCTP inbound to Arc.

- Users bridge USDC from Base Sepolia, Arbitrum Sepolia, or Ethereum Sepolia to Arc.
- Backend indexes source burns, verifies CCTP attestations, then records/settles vault creation.
- Store actual EVM source chain IDs in the database and contracts.

Phase 3: CCTP outbound claims.

- Mature claims initiate CCTP back to the user's selected destination chain.
- Claim status should remain pending until the destination mint is observed.

Phase 4: Multi-token expansion.

- Add only tokens with verified cross-chain representations first.
- Require per-token route configuration, adapter contracts where needed, and bridge-specific reserve checks.
- Do not promise arbitrary ERC-20 round trips until each token has a verified cross-chain representation.

## Network Constants

| Concept | Value |
| --- | --- |
| Arc Testnet EVM chain ID | `5042002` |
| Arc Testnet CCTP domain | `26` |
| Arc Testnet RPC | `https://rpc.testnet.arc.network` |
| Arc Testnet explorer | `https://testnet.arcscan.app` |
| Arc USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` |
| CCTP V2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| CCTP V2 MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

## Contract Rule

Use `uint32` or larger for chain identifiers. `uint8` cannot represent real EVM chain IDs such as Base Sepolia `84532`, Arbitrum Sepolia `421614`, Ethereum Sepolia `11155111`, or Arc Testnet `5042002`.

Bridge protocol can remain a small enum/code, but chain ID and CCTP domain should be separate concepts.

## How attestation verification works

Inbound and outbound CCTP transfers are settled with real Circle attestations, not a
relayer-trusted shortcut. The flow lives in `backend/src/services/cctpRelayService.js` and
`backend/src/services/bridgeTrackerService.js`:

1. **Fetch.** `cctpRelayService.fetchMessage(sourceDomain, txHash)` calls Circle's Iris API
   (`GET https://iris-api-sandbox.circle.com/v2/messages/{sourceDomainId}?transactionHash={txHash}`)
   and returns the decoded message record, including `status`, `message`, and `attestation`.
2. **Poll with backoff.** `waitForAttestation()` polls that endpoint until `status === "complete"`
   and both `message` and `attestation` are present, or a timeout elapses. If attestation is not
   yet ready the caller is told `PENDING_ATTESTATION` rather than erroring.
3. **Verify before relaying.** Once attestation is ready, `finalizeBurnAndMint()` decodes the CCTP
   message body and checks the mint recipient and amount against what the backend expects
   *before* it will submit anything. A recipient mismatch is a hard failure (`RECIPIENT_MISMATCH`),
   not a silent pass-through.
4. **Submit the real receiveMessage call.** The verified `(message, attestation)` pair is sent to
   the canonical CCTP `MessageTransmitterV2.receiveMessage(message, attestation)` on the
   destination chain (Arc for inbound, the chosen destination chain for outbound claims). This is
   Circle's own contract, not a custom shim - it independently verifies the attestation signature
   and enforces its own nonce-based replay protection.
5. **State machine.** `bridge_transactions.bridge_state` persists progress through
   `PENDING_ATTESTATION -> ATTESTED -> RECEIVED_ON_ARC -> VAULT_CREATED` (see
   `backend/src/db/schema.sql`), so if the backend crashes mid-flow, `bridgeTrackerService`'s
   polling loop resumes exactly where it left off on the next tick instead of getting stuck. All
   Arc-side application contracts additionally track processed CCTP message hashes
   (`CCTPReceiver.processedMessages`) and reject replays and calls from any address other than the
   configured MessageTransmitter, as a defense-in-depth layer on top of Circle's own replay guard.

## Open Implementation Risks

- Claim and flexible withdrawal flows must move real tokens on-chain before this can be called non-custodial.
- Proof-of-reserves must read actual vault token balances, not database-only totals.
- Arbitrary-token support requires current Arc route confirmation before any implementation promise.
- ScheduledPayment (treasury payroll) execution relies on a single centralized backend cron
  keeper (`backend/src/services/scheduledPaymentService.js`) since no on-chain keeper network is
  live on Arc Testnet yet. All payment-safety logic (due timestamp, double-execution guard,
  balance threshold guard) is enforced on-chain in `ScheduledPayment.sol`, so the keeper can only
  delay a payment, never steal funds or bypass the guard. See the comment at the top of that file
  for the plan to move to Chainlink Automation (or equivalent) once available on Arc.

## References

- Arc network setup: https://docs.arc.network/arc/references/connect-to-arc
- Arc contract addresses and CCTP domain: https://docs.arc.network/arc/references/contract-addresses
- Arc App Kit supported bridge tokens/chains: https://docs.arc.network/app-kit/references/supported-blockchains
- Circle CCTP contract addresses: https://developers.circle.com/stablecoins/evm-smart-contracts
- Circle CCTP domains: https://developers.circle.com/stablecoins/supported-domains
