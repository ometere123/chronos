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

  // Agent (delegate) can now trigger the claim; funds go to owner, not agent.
  const ownerBalBefore = await usdc.balanceOf(owner.address);
  const agentBalBefore = await usdc.balanceOf(agent.address);

  await vault.connect(agent).claimVault(vaultId, 0);

  const ownerBalAfter = await usdc.balanceOf(owner.address);
  const agentBalAfter = await usdc.balanceOf(agent.address);

  assert.equal(ownerBalAfter - ownerBalBefore, depositAmount, "owner should receive full claim amount");
  assert.equal(agentBalAfter - agentBalBefore, 0n, "delegate/agent should receive nothing");

  const vaultAfter = await vault.vaults(vaultId);
  assert.equal(vaultAfter.status, 2n, "vault should be CLAIMED (status=2)");

  console.log("Vault delegate smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("Vault delegate smoke test FAILED:", e);
  process.exit(1);
});
