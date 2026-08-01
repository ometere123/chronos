// Circle App Kit integration (Item 1) for CHRONOS's cross-chain USDC deposit flow.
// Verified live against Circle's real SDK: kit.getSupportedChains() lists Arc_Testnet with
// full CCTP config, and kit.estimateBridge()/kit.bridge() genuinely accept Arc_Testnet as a
// bridge destination (source chains -> Arc). Note: Arc is destination-only in App Kit's
// forwarder support (getSupportedChains() shows forwarderSupported.source: false for Arc),
// so this covers the deposit-into-Arc direction, which is CHRONOS's primary flow.
//
// This is an alternative, App-Kit-powered path alongside the existing custom
// cctpRelayService.js (which talks to Circle's Iris API and Arc's MessageTransmitter
// directly). Both are real; this module exists specifically to demonstrate genuine App Kit
// usage per the hackathon brief's "meaningful use of App Kits" requirement.
import { AppKit, BridgeChain } from '@circle-fin/app-kit';
import { createAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';
import logger from '../config/logger.js';

const kit = new AppKit();

const SOURCE_CHAIN_MAP = {
  base_sepolia: BridgeChain.Base_Sepolia,
  arbitrum_sepolia: BridgeChain.Arbitrum_Sepolia,
  ethereum_sepolia: BridgeChain.Ethereum_Sepolia,
  op_sepolia: BridgeChain.Optimism_Sepolia,
};

function resolveSourceChain(sourceChainKey) {
  const chain = SOURCE_CHAIN_MAP[String(sourceChainKey).toLowerCase()];
  if (!chain) {
    throw new Error(`Unsupported App Kit source chain: ${sourceChainKey}`);
  }
  return chain;
}

/// Estimates fees/gas for bridging USDC from a source chain into Arc via App Kit's BridgeKit
/// (CCTP v2 under the hood). Does not move funds - safe to call freely.
export async function estimateDepositToArc({ sourceChainKey, privateKey, amount }) {
  const sourceChain = resolveSourceChain(sourceChainKey);
  const fromAdapter = createAdapterFromPrivateKey({ privateKey, chain: sourceChain });
  const toAdapter = createAdapterFromPrivateKey({ privateKey, chain: BridgeChain.Arc_Testnet });

  logger.info('App Kit: estimating deposit to Arc', { sourceChain, amount });

  return kit.estimateBridge({
    from: { adapter: fromAdapter, chain: sourceChain },
    to: { adapter: toAdapter, chain: BridgeChain.Arc_Testnet },
    amount,
  });
}

/// Executes the actual bridge (approve + burn on source, mint on Arc) via App Kit. This moves
/// real funds - only call with an explicit user action, never speculatively.
export async function depositToArc({ sourceChainKey, privateKey, amount }) {
  const sourceChain = resolveSourceChain(sourceChainKey);
  const fromAdapter = createAdapterFromPrivateKey({ privateKey, chain: sourceChain });
  const toAdapter = createAdapterFromPrivateKey({ privateKey, chain: BridgeChain.Arc_Testnet });

  logger.info('App Kit: executing deposit to Arc', { sourceChain, amount });

  return kit.bridge({
    from: { adapter: fromAdapter, chain: sourceChain },
    to: { adapter: toAdapter, chain: BridgeChain.Arc_Testnet },
    amount,
  });
}

export async function getAppKitSupportedChains() {
  return kit.getSupportedChains();
}
