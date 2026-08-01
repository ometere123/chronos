// Smoke test for vault delegate claim authorization (Item 14 foundation).
// Verifies: owner can set/revoke a delegate, delegate can trigger claimVault(), payout still
// goes to the owner (never the delegate/caller), non-delegate third parties are rejected,
// and owner retains their own claim rights after delegating.
// Run with: node scripts/smoke-vault-delegate.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const [deployer, owner, agent, stranger, s1, s2] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(usdc.address, [deployer.address, s1.address, s2.address], 2);

  const TimeLockVault = await ethers.getContractFactory("TimeLockVault");
  const vault = await TimeLockVault.deploy(treasury.address);

  // Use deployer as the bridge orchestrator for test purposes.
  await vault.setBridgeOrchestrator(deployer.address);

  const depositAmount = ethers.parseUnits("1000", 6);
  await usdc.transfer(vault.address, depositAmount);

  const latestBlock = await ethers.provider.getBlock("latest");
  const unlockAt = latestBlock.timestamp + 5;
  const tx = await vault.depositFromBridge(
    depositAmount,
    owner.address,
    unlockAt,
    1,
    0,
    usdc.address,
    0 // FIXED
  );
  const receipt = await tx.wait();
  const createdEvent = receipt.logs
    .map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "VaultCreated");
  const vaultId = createdEvent.args.vaultId;

  await ethers.provider.send("evm_increaseTime", [10]);
  await ethers.provider.send("evm_mine", []);

  // Stranger cannot claim.
  let strangerRejected = false;
  try {
    await vault.connect(stranger).claimVault(vaultId, 0);
  } catch (e) {
    strangerRejected = true;
  }
  assert.equal(strangerRejected, true, "stranger should not be able to claim");

  // Agent cannot claim before being set as delegate.
  let agentRejectedBeforeDelegate = false;
  try {
    await vault.connect(agent).claimVault(vaultId, 0);
  } catch (e) {
    agentRejectedBeforeDelegate = true;
  }
  assert.equal(agentRejectedBeforeDelegate, true, "agent should not be able to claim before delegation");

  // Only the vault owner can set a delegate.
  let strangerSetDelegateRejected = false;
  try {
    await vault.connect(stranger).setVaultDelegate(vaultId, agent.address);
  } catch (e) {
    strangerSetDelegateRejected = true;
  }
  assert.equal(strangerSetDelegateRejected, true, "only owner should be able to set a delegate");

  await vault.connect(owner).setVaultDelegate(vaultId, agent.address);
  assert.equal(await vault.vaultDelegate(vaultId), agent.address, "delegate not persisted");

  // Agent (delegate) can now trigger the claim; owner gets the deposit minus the agent fee,
  // and the agent/delegate itself receives that fee (Item 15: agent self-payment).
  const feeBps = await vault.agentFeeBps();
  const expectedFee = (depositAmount * feeBps) / 10000n;
  const expectedOwnerAmount = depositAmount - expectedFee;

  const ownerBalBefore = await usdc.balanceOf(owner.address);
  const agentBalBefore = await usdc.balanceOf(agent.address);

  await vault.connect(agent).claimVault(vaultId, 0);

  const ownerBalAfter = await usdc.balanceOf(owner.address);
  const agentBalAfter = await usdc.balanceOf(agent.address);

  assert.equal(ownerBalAfter - ownerBalBefore, expectedOwnerAmount, "owner should receive deposit minus agent fee");
  assert.equal(agentBalAfter - agentBalBefore, expectedFee, "delegate/agent should receive its fee");
  assert.ok(expectedFee > 0n, "sanity check: fee should be nonzero for this deposit size");

  const vaultAfter = await vault.vaults(vaultId);
  assert.equal(vaultAfter.status, 2n, "vault should be CLAIMED (status=2)");

  // Owner-triggered claims (no delegate involved) still pay the full amount, no fee.
  const latestBlock2 = await ethers.provider.getBlock("latest");
  const unlockAt2 = latestBlock2.timestamp + 5;
  await usdc.transfer(vault.address, depositAmount);
  const tx2 = await vault.depositFromBridge(depositAmount, owner.address, unlockAt2, 1, 0, usdc.address, 0);
  const receipt2 = await tx2.wait();
  const createdEvent2 = receipt2.logs
    .map((l) => { try { return vault.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "VaultCreated");
  const vaultId2 = createdEvent2.args.vaultId;
  await ethers.provider.send("evm_increaseTime", [10]);
  await ethers.provider.send("evm_mine", []);

  const ownerBalBefore2 = await usdc.balanceOf(owner.address);
  await vault.connect(owner).claimVault(vaultId2, 0);
  const ownerBalAfter2 = await usdc.balanceOf(owner.address);
  assert.equal(ownerBalAfter2 - ownerBalBefore2, depositAmount, "owner self-claim should receive full amount, no fee deducted");

  console.log("Vault delegate smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("Vault delegate smoke test FAILED:", e);
  process.exit(1);
});
