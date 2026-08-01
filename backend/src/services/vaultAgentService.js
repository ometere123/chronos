// Autonomous vault-maintenance agent (Items 14-16). Scans TimeLockVault for vaults that have
// delegated claim rights to this agent's Circle Wallet (CIRCLE_AGENT_WALLET_ADDRESS, set via
// TimeLockVault.setVaultDelegate() by the vault owner) and are mature + unclaimed, then triggers
// claimVault() as the agent using Circle's Developer-Controlled Wallets contract-execution API.
// The agent is paid automatically on-chain via TimeLockVault's agentFeeBps mechanism (Item 15) -
// no separate off-chain payment step is needed, the fee split happens inside claimVault() itself.
import { ethers } from 'ethers';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { contractAddresses } from '../config/contracts.js';
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

/// Returns vaults that are: delegated to this agent, ACTIVE, mature, and not locked as
/// CreditLine collateral - i.e. eligible for the agent to autonomously claim.
export async function findEligibleDelegatedVaults() {
  const agentAddress = (process.env.CIRCLE_AGENT_WALLET_ADDRESS || '').toLowerCase();
  if (!agentAddress) {
    throw new Error('CIRCLE_AGENT_WALLET_ADDRESS not configured');
  }

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

/// Submits claimVault(vaultId, destinationChain) as the agent's Circle Wallet via Circle's
/// contract-execution transaction API. Returns Circle's transaction record (async - Circle
/// broadcasts and confirms the transaction; callers should poll transaction status).
export async function executeAgentClaim(vaultId, destinationChain = 0) {
  const client = getCircleClient();
  const walletId = process.env.CIRCLE_AGENT_WALLET_ID;

  if (!walletId) {
    throw new Error('CIRCLE_AGENT_WALLET_ID not configured');
  }
  if (!contractAddresses.timeLockVault) {
    throw new Error('ARC_TIMELOCK_VAULT_ADDRESS not configured');
  }

  logger.info('Agent submitting autonomous claim', { vaultId, destinationChain });

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

/// One pass of the agent loop: find eligible vaults, claim each, log outcome. Intended to be
/// invoked on a schedule (see scheduledPaymentService.js for the node-cron pattern this mirrors).
export async function runAgentPass() {
  const eligible = await findEligibleDelegatedVaults();
  logger.info('Vault agent pass: eligible vaults found', { count: eligible.length });

  const results = [];
  for (const { vaultId, owner, totalAmount } of eligible) {
    try {
      const tx = await executeAgentClaim(vaultId);
      logger.info('Vault agent claim submitted', { vaultId, owner, totalAmount, txId: tx.id });
      results.push({ vaultId, status: 'submitted', txId: tx.id });
    } catch (err) {
      logger.error('Vault agent claim failed', { vaultId, error: err.message });
      results.push({ vaultId, status: 'failed', error: err.message });
    }
  }

  return results;
}
