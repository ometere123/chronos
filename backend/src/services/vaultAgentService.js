// Autonomous vault-maintenance agent (Items 14-16). Scans TimeLockVault for vaults that have
// delegated claim rights to the agent and are mature + unclaimed, then triggers claimVault() on
// the owner's behalf. The agent is paid automatically on-chain via TimeLockVault's agentFeeBps
// mechanism (Item 15) - no separate off-chain payment step, the fee split happens inside
// claimVault() itself.
//
// Two execution identities exist for the agent, deliberately kept separate:
//   1. The ERC-4337 smart account (agentSmartAccountService.js) - PRIMARY path. Gas-sponsored
//      via Pimlico's real, verified-working bundler+paymaster on Arc Testnet, so the agent
//      never needs to hold Arc gas. Proven live: a real sponsored UserOperation was submitted
//      and confirmed on-chain (block 54751883) with both the owner key and smart account at
//      zero balance - the paymaster genuinely covered gas.
//   2. The Circle Developer-Controlled Wallet (circleWalletService.js) - kept as a documented
//      alternative path. It works but is NOT gas-sponsored: it would need to hold Arc gas
//      itself, which it currently does not (see README known-limitations).
// findEligibleDelegatedVaults() checks delegation against the smart account address, since
// that's the identity vault owners should actually authorize via setVaultDelegate().
import { ethers } from 'ethers';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { contractAddresses } from '../config/contracts.js';
import { getAgentSmartAccountAddress, sendSponsoredCall, waitForSponsoredCall } from './agentSmartAccountService.js';
import logger from '../config/logger.js';

const TIME_LOCK_VAULT_ABI = [
  'function getAllVaultIds() view returns (bytes32[])',
  'function vaults(bytes32) view returns (bytes32 vaultId, address owner, uint256 totalAmount, uint256 createdAt, uint256 unlockAt, uint32 sourceChain, uint8 bridgeProtocol, address tokenAddress, uint8 vaultType, uint8 status, bytes32 bridgeTxHash, address conditionOracle, uint256 conditionThreshold, bool conditionAbove, address treasuryBalanceCheck, uint256 treasuryBalanceThreshold, uint32 numTranches, uint32 claimedTranches, uint256 intervalSeconds)',
  'function vaultDelegate(bytes32) view returns (address)',
  'function vaultLocked(bytes32) view returns (bool)',
  'function claimVault(bytes32 vaultId, uint32 destinationChain) external',
];

let circleClient = null;
function getCircleClient() {
  if (circleClient) return circleClient;
  circleClient = initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });
  return circleClient;
}

const VAULT_STATUS_ACTIVE = 0;

/// Returns vaults that are: delegated to this agent's smart account, ACTIVE, mature, and not
/// locked as CreditLine collateral - i.e. eligible for the agent to autonomously claim.
export async function findEligibleDelegatedVaults() {
  const agentAddress = (await getAgentSmartAccountAddress()).toLowerCase();

  const provider = new ethers.JsonRpcProvider(contractAddresses.arcRpcUrl);
  const vaultContract = new ethers.Contract(contractAddresses.timeLockVault, TIME_LOCK_VAULT_ABI, provider);

  const allVaultIds = await vaultContract.getAllVaultIds();
  const now = Math.floor(Date.now() / 1000);
  const eligible = [];

  for (const vaultId of allVaultIds) {
    const delegate = await vaultContract.vaultDelegate(vaultId);
    if (delegate.toLowerCase() !== agentAddress) continue;

    const vault = await vaultContract.vaults(vaultId);
    if (Number(vault.status) !== VAULT_STATUS_ACTIVE) continue;
    if (Number(vault.unlockAt) > now) continue;
    if (Number(vault.numTranches) > 0) continue; // streaming vaults use a different claim path

    const locked = await vaultContract.vaultLocked(vaultId);
    if (locked) continue;

    eligible.push({ vaultId, owner: vault.owner, totalAmount: vault.totalAmount.toString() });
  }

  return eligible;
}

/// PRIMARY claim path: submits claimVault(vaultId, destinationChain) as the agent's ERC-4337
/// smart account, gas-sponsored by Pimlico's paymaster on Arc Testnet. Waits for the
/// UserOperation receipt and returns it (includes the underlying tx hash and success status).
export async function executeAgentClaim(vaultId, destinationChain = 0) {
  if (!contractAddresses.timeLockVault) {
    throw new Error('ARC_TIMELOCK_VAULT_ADDRESS not configured');
  }

  logger.info('Agent submitting sponsored autonomous claim', { vaultId, destinationChain });

  const iface = new ethers.Interface(TIME_LOCK_VAULT_ABI);
  const data = iface.encodeFunctionData('claimVault', [vaultId, destinationChain]);

  const userOpHash = await sendSponsoredCall({ to: contractAddresses.timeLockVault, data });
  const receipt = await waitForSponsoredCall(userOpHash);

  return { userOpHash, ...receipt };
}

/// ALTERNATIVE claim path via the agent's Circle Developer-Controlled Wallet. Not gas-sponsored
/// - the wallet needs its own Arc gas, which it does not currently hold (see README known
/// limitations). Kept for reference / as a fallback once the wallet is funded.
export async function executeAgentClaimViaCircleWallet(vaultId, destinationChain = 0) {
  const client = getCircleClient();
  const walletId = process.env.CIRCLE_AGENT_WALLET_ID;

  if (!walletId) {
    throw new Error('CIRCLE_AGENT_WALLET_ID not configured');
  }
  if (!contractAddresses.timeLockVault) {
    throw new Error('ARC_TIMELOCK_VAULT_ADDRESS not configured');
  }

  logger.info('Agent submitting autonomous claim via Circle Wallet', { vaultId, destinationChain });

  const iface = new ethers.Interface(TIME_LOCK_VAULT_ABI);
  const callData = iface.encodeFunctionData('claimVault', [vaultId, destinationChain]);

  const resp = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: contractAddresses.timeLockVault,
    callData,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  return resp.data;
}

/// One pass of the agent loop: find eligible vaults, claim each via the sponsored smart account
/// path, log outcome. Intended to be invoked on a schedule (see scheduledPaymentService.js for
/// the node-cron pattern this mirrors).
export async function runAgentPass() {
  const eligible = await findEligibleDelegatedVaults();
  logger.info('Vault agent pass: eligible vaults found', { count: eligible.length });

  const results = [];
  for (const { vaultId, owner, totalAmount } of eligible) {
    try {
      const result = await executeAgentClaim(vaultId);
      logger.info('Vault agent claim confirmed', { vaultId, owner, totalAmount, txHash: result.receipt?.transactionHash, success: result.success });
      results.push({ vaultId, status: result.success ? 'confirmed' : 'reverted', userOpHash: result.userOpHash });
    } catch (err) {
      logger.error('Vault agent claim failed', { vaultId, error: err.message });
      results.push({ vaultId, status: 'failed', error: err.message });
    }
  }

  return results;
}
