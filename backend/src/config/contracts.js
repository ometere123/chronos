import './env.js';
import { ethers } from 'ethers';

const ARC_DEFAULTS = {
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.network',
  explorerBaseUrl: 'https://testnet.arcscan.app',
  usdc: '0x3600000000000000000000000000000000000000',
};

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() && !value.includes('...')) {
      return value.trim();
    }
  }

  return '';
}

function normalizeAddress(address) {
  if (!address || !ethers.isAddress(address)) {
    return '';
  }

  return ethers.getAddress(address);
}

export const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || ARC_DEFAULTS.chainId);

export const contractAddresses = {
  arcChainId: ARC_CHAIN_ID,
  arcRpcUrl: process.env.ARC_TESTNET_RPC || ARC_DEFAULTS.rpcUrl,
  explorerBaseUrl: process.env.ARC_EXPLORER_BASE_URL || ARC_DEFAULTS.explorerBaseUrl,
  usdc: normalizeAddress(firstEnv('ARC_USDC')) || ARC_DEFAULTS.usdc,
  cctpTokenMessenger: normalizeAddress(
    firstEnv('ARC_CCTP_TOKEN_MESSENGER', 'CCTP_TOKEN_MESSENGER')
  ),
  cctpMessageTransmitter: normalizeAddress(
    firstEnv('ARC_CCTP_MESSAGE_TRANSMITTER', 'CCTP_MESSAGE_TRANSMITTER')
  ),
  timeLockVault: normalizeAddress(
    firstEnv('ARC_TIMELOCK_VAULT', 'ARC_TIMELOCK_VAULT_ADDRESS')
  ),
  bridgeOrchestrator: normalizeAddress(
    firstEnv('ARC_BRIDGE_ORCHESTRATOR', 'ARC_BRIDGE_ORCHESTRATOR_ADDRESS')
  ),
  vaultFactory: normalizeAddress(
    firstEnv('ARC_VAULT_FACTORY', 'ARC_VAULT_FACTORY_ADDRESS')
  ),
  treasury: normalizeAddress(
    firstEnv('ARC_TREASURY', 'ARC_TREASURY_ADDRESS')
  ),
  proofOfReserves: normalizeAddress(
    firstEnv('ARC_PROOF_OF_RESERVES', 'ARC_PROOF_OF_RESERVES_ADDRESS')
  ),
  governanceTimelock: normalizeAddress(
    firstEnv('ARC_GOVERNANCE_TIMELOCK', 'ARC_GOVERNANCE_TIMELOCK_ADDRESS')
  ),
  scheduledPayment: normalizeAddress(
    firstEnv('ARC_SCHEDULED_PAYMENT', 'ARC_SCHEDULED_PAYMENT_ADDRESS')
  ),
};

export function getExplorerAddressUrl(address) {
  if (!address) {
    return '';
  }

  return `${contractAddresses.explorerBaseUrl}/address/${address}`;
}
