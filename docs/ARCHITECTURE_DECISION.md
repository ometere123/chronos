# CHRONOS Architecture Decision

Date: 2026-05-12

## Decision

CHRONOS should keep Arc Testnet as the canonical settlement chain for the first testnet launch. The vault, treasury, proof-of-reserves, and governance contracts should live on Arc. Source-chain contracts should be avoided unless a bridge integration strictly requires a minimal adapter.

The first launch should focus on USDC over Circle CCTP V2. Arbitrary ERC-20 and LayerZero/OFT support should be treated as a later milestone after the USDC path is production-quality on testnet.

## Why

- Arc docs list Arc Testnet EVM chain ID as `5042002`, RPC as `https://rpc.testnet.arc.network`, and explorer as `https://testnet.arcscan.app`.
- Arc docs list Arc's Circle CCTP domain as `26`. This is not the EVM chain ID.
- Arc App Kit bridge support is USDC-only. Arc docs do not currently provide a LayerZero endpoint address for Arc Testnet.
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

Phase 4: Multi-token LayerZero/OFT.

- Add only OFT-compliant tokens first.
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

Bridge protocol can remain a small enum/code, but chain ID, CCTP domain, and LayerZero endpoint ID should be separate concepts.

## Open Implementation Risks

- The current bridge orchestrator is still a relayer-assisted stub, not full CCTP attestation enforcement.
- Claim and flexible withdrawal flows must move real tokens on-chain before this can be called non-custodial.
- Proof-of-reserves must read actual vault token balances, not database-only totals.
- LayerZero support requires current Arc endpoint confirmation before any implementation promise.

## References

- Arc network setup: https://docs.arc.network/arc/references/connect-to-arc
- Arc contract addresses and CCTP domain: https://docs.arc.network/arc/references/contract-addresses
- Arc App Kit supported bridge tokens/chains: https://docs.arc.network/app-kit/references/supported-blockchains
- Circle CCTP contract addresses: https://developers.circle.com/stablecoins/evm-smart-contracts
- Circle CCTP domains: https://developers.circle.com/stablecoins/supported-domains
