// Real end-to-end proof on live Arc Testnet (not a local Hardhat fork): creates a real vault,
// delegates it to the agent's ERC-4337 smart account, and executes a genuinely gas-sponsored
// claim via Pimlico's paymaster. Temporarily repoints TimeLockVault.bridgeOrchestratorAddress
// to the deployer to create the test vault directly, then restores it to the real
// BridgeOrchestrator contract afterward. Run with: node scripts/e2e-agent-sponsored-claim.js
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '../.env.local', override: false });

const TIME_LOCK_VAULT_ABI = [
  'function bridgeOrchestratorAddress() view returns (address)',
  'function setBridgeOrchestrator(address) external',
  'function depositFromBridge(uint256,address,uint256,uint32,uint8,address,uint8) external returns (bytes32)',
  'function setVaultDelegate(bytes32,address) external',
  'function vaults(bytes32) view returns (bytes32,address,uint256,uint256,uint256,uint32,uint8,address,uint8,uint8,bytes32,address,uint256,bool,address,uint256,uint32,uint32,uint256)',
  'event VaultCreated(bytes32 indexed vaultId, address indexed owner, uint256 totalAmount, uint256 unlockAt)',
];
const ERC20_ABI = ['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_TESTNET_RPC);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const vaultAddr = process.env.ARC_TIMELOCK_VAULT_ADDRESS;
  const usdcAddr = process.env.ARC_USDC;
  const vault = new ethers.Contract(vaultAddr, TIME_LOCK_VAULT_ABI, deployer);
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, deployer);

  const originalOrchestrator = await vault.bridgeOrchestratorAddress();
  console.log('Original bridgeOrchestratorAddress:', originalOrchestrator);

  console.log('\n1. Temporarily repointing bridgeOrchestratorAddress to deployer...');
  let tx = await vault.setBridgeOrchestrator(deployer.address);
  await tx.wait();

  const depositAmount = 1_000_000n; // 1.00 USDC (6 decimals)
  console.log('\n2. Funding TimeLockVault with 1 USDC...');
  tx = await usdc.transfer(vaultAddr, depositAmount);
  await tx.wait();

  const unlockAt = Math.floor(Date.now() / 1000) + 15;
  console.log('\n3. Creating a real vault, unlockAt in 15s...');
  tx = await vault.depositFromBridge(depositAmount, deployer.address, unlockAt, 1, 0, usdcAddr, 0);
  const receipt = await tx.wait();
  const createdLog = receipt.logs.map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'VaultCreated');
  const vaultId = createdLog.args.vaultId;
  console.log('   vaultId:', vaultId);

  console.log('\n4. Restoring bridgeOrchestratorAddress to the real BridgeOrchestrator...');
  tx = await vault.setBridgeOrchestrator(originalOrchestrator);
  await tx.wait();

  console.log('\n5. Fetching agent smart account address...');
  const { getAgentSmartAccountAddress, sendSponsoredCall, waitForSponsoredCall } = await import('../../backend/src/services/agentSmartAccountService.js');
  const agentAddress = await getAgentSmartAccountAddress();
  console.log('   agent smart account:', agentAddress);

  console.log('\n6. Owner delegates claim rights to the agent...');
  tx = await vault.setVaultDelegate(vaultId, agentAddress);
  await tx.wait();

  console.log('\n7. Waiting for vault to mature (15s)...');
  await new Promise((r) => setTimeout(r, 16000));

  const ownerBalBefore = await usdc.balanceOf(deployer.address);
  const agentBalBefore = await usdc.balanceOf(agentAddress);

  console.log('\n8. Agent executes a REAL, gas-sponsored claim via Pimlico...');
  const iface = new ethers.Interface(TIME_LOCK_VAULT_ABI);
  const data = iface.encodeFunctionData('claimVault', [vaultId, 0]);
  const userOpHash = await sendSponsoredCall({ to: vaultAddr, data });
  console.log('   userOpHash:', userOpHash);
  const opReceipt = await waitForSponsoredCall(userOpHash);
  console.log('   success:', opReceipt.success, ' txHash:', opReceipt.receipt?.transactionHash);

  const ownerBalAfter = await usdc.balanceOf(deployer.address);
  const agentBalAfter = await usdc.balanceOf(agentAddress);

  console.log('\n=== RESULTS ===');
  console.log('Owner USDC gained:', (ownerBalAfter - ownerBalBefore).toString());
  console.log('Agent USDC gained (on-chain fee):', (agentBalAfter - agentBalBefore).toString());
  console.log('Agent smart account Arc gas balance (should be 0 - proves sponsorship):', (await provider.getBalance(agentAddress)).toString());
}

main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
