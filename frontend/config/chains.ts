import { ChainConfig } from '../types';

export const ARC_CHAIN_ID = 5042002;
export const ARC_CCTP_DOMAIN = 26;

export const CCTP_V2_TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
export const CCTP_V2_MESSAGE_TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275';

export const CHAINS: Record<number, ChainConfig> = {
  [ARC_CHAIN_ID]: {
    id: ARC_CHAIN_ID,
    name: 'Arc Testnet',
    rpc: 'https://rpc.testnet.arc.network',
    explorer: 'https://testnet.arcscan.app',
    usdc: '0x3600000000000000000000000000000000000000',
    cctpDomain: ARC_CCTP_DOMAIN,
    cctpTokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    cctpMessageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    cctpDomain: 6,
    cctpTokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    cctpMessageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  421614: {
    id: 421614,
    name: 'Arbitrum Sepolia',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    explorer: 'https://sepolia.arbiscan.io',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    cctpDomain: 3,
    cctpTokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    cctpMessageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  11155111: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpc: 'https://ethereum-sepolia.publicnode.com',
    explorer: 'https://sepolia.etherscan.io',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    cctpDomain: 0,
    cctpTokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    cctpMessageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
  11155420: {
    id: 11155420,
    name: 'OP Sepolia',
    rpc: 'https://sepolia.optimism.io',
    explorer: 'https://sepolia-optimism.etherscan.io',
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    cctpDomain: 2,
    cctpTokenMessenger: CCTP_V2_TOKEN_MESSENGER,
    cctpMessageTransmitter: CCTP_V2_MESSAGE_TRANSMITTER,
  },
};

export const SOURCE_CHAINS = [84532, 421614, 11155111];
export const CANONICAL_CHAIN = ARC_CHAIN_ID;

export const getChain = (chainId: number) => CHAINS[chainId];
export const getChainName = (chainId: number) => CHAINS[chainId]?.name || 'Unknown';
