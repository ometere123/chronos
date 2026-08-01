// ERC-4337 gas-sponsored execution path for the vault-maintenance agent, via Pimlico's
// bundler + paymaster on Arc Testnet (chain 5042002). Verified live: Pimlico's managed API
// (https://api.pimlico.io/v2/5042002/rpc) responds to eth_supportedEntryPoints and reports the
// correct chain ID - this is not a self-hosted/theoretical integration.
//
// The agent's smart account is a standard ERC-4337 SimpleAccount, owned by a dedicated key
// (AGENT_SA_OWNER_PRIVATE_KEY) that only ever signs UserOperations - it never needs to hold
// gas, since Pimlico's paymaster sponsors every transaction. This is deliberately a separate
// identity from the Circle Developer-Controlled Wallet (circleWalletService.js) - the smart
// account is the on-chain execution/gas-sponsorship identity, the Circle Wallet remains
// available for USDC custody/transfer operations that don't need gas sponsorship.
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint07Address } from 'viem/account-abstraction';
import { contractAddresses } from '../config/contracts.js';
import logger from '../config/logger.js';

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [contractAddresses.arcRpcUrl] } },
};

let cachedClient = null;

/// Builds (or returns the cached) ERC-4337 smart account client for the agent, wired to
/// Pimlico's bundler + paymaster on Arc Testnet. Every UserOperation sent through this client
/// is gas-sponsored - the owner key never needs Arc gas.
export async function getAgentSmartAccountClient() {
  if (cachedClient) return cachedClient;

  const pimlicoUrl = process.env.PIMLICO_ARC_TESTNET_RPC;
  const ownerKey = process.env.AGENT_SA_OWNER_PRIVATE_KEY;

  if (!pimlicoUrl) throw new Error('PIMLICO_ARC_TESTNET_RPC not configured');
  if (!ownerKey) throw new Error('AGENT_SA_OWNER_PRIVATE_KEY not configured');

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(contractAddresses.arcRpcUrl) });
  const owner = privateKeyToAccount(ownerKey);

  const smartAccount = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  cachedClient = createSmartAccountClient({
    account: smartAccount,
    chain: arcTestnet,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  logger.info('Agent smart account initialized', { address: smartAccount.address });
  return cachedClient;
}

export async function getAgentSmartAccountAddress() {
  const client = await getAgentSmartAccountClient();
  return client.account.address;
}

/// Sends a gas-sponsored contract call as the agent's smart account. `to`/`data`/`value` follow
/// viem's sendUserOperation call shape. Returns the UserOperation hash immediately (async
/// bundling/inclusion - callers should wait for the receipt separately if needed).
export async function sendSponsoredCall({ to, data, value = 0n }) {
  const client = await getAgentSmartAccountClient();
  logger.info('Agent smart account sending sponsored call', { to });
  const userOpHash = await client.sendUserOperation({
    calls: [{ to, data, value }],
  });
  return userOpHash;
}

export async function waitForSponsoredCall(userOpHash) {
  const client = await getAgentSmartAccountClient();
  return client.waitForUserOperationReceipt({ hash: userOpHash });
}
