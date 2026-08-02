import { defineChain } from 'viem';
import { CHAINS, ARC_CHAIN_ID } from './chains';

// Privy needs viem Chain objects (not our internal ChainConfig shape) for supportedChains/
// defaultChain. Arc is just a custom EVM chain here - no Arc-specific allowlisting needed on
// Privy's side, unlike Circle's User-Controlled Wallets which required confirmed platform
// support per chain.
function toViemChain(chainId: number) {
  const chain = CHAINS[chainId];
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: {
      name: chain.id === ARC_CHAIN_ID ? 'USDC' : 'Ether',
      symbol: chain.id === ARC_CHAIN_ID ? 'USDC' : 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [chain.rpc] },
    },
    blockExplorers: {
      default: { name: `${chain.name} Explorer`, url: chain.explorer },
    },
  });
}

export const arcTestnetViemChain = toViemChain(ARC_CHAIN_ID);
export const privySupportedChains = Object.keys(CHAINS).map((id) => toViemChain(Number(id)));
