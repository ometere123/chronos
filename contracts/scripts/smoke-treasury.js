// Standalone smoke test for Treasury.sol (ERC20-based fees), bypassing chai-matchers
// which are not functional under this Hardhat 3 + node:test setup (pre-existing repo gap).
// Run with: node scripts/smoke-treasury.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const { ethers } = await hre.network.connect();
  const [owner, signer1, signer2, signer3, user1] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const mockToken = await MockERC20.deploy("USD Coin", "USDC", ethers.parseEther("1000000"));

  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    mockToken.address,
    [signer1.address, signer2.address, signer3.address],
    2
  );

  assert.equal(await treasury.usdc(), mockToken.address, "usdc address mismatch");

  await mockToken.approve(treasury.address, ethers.MaxUint256);

  const amount = ethers.parseEther("100");
  await treasury.depositFee(amount);
  assert.equal(await treasury.getBalance(), amount, "balance after deposit mismatch");
  assert.equal(await mockToken.balanceOf(treasury.address), amount, "treasury did not receive USDC");

  const before = await mockToken.balanceOf(user1.address);
  await treasury.withdrawFee(ethers.parseEther("40"), user1.address);
  const after = await mockToken.balanceOf(user1.address);
  assert.equal(after - before, ethers.parseEther("40"), "withdrawal did not transfer USDC");
  assert.equal(await treasury.getBalance(), ethers.parseEther("60"), "balance after withdrawal mismatch");

  // deposit without allowance should fail
  const MockERC20b = await ethers.getContractFactory("MockERC20");
  const otherToken = await MockERC20b.deploy("Other", "OTH", ethers.parseEther("1000"));
  const Treasury2 = await ethers.getContractFactory("Treasury");
  const treasury2 = await Treasury2.deploy(otherToken.address, [signer1.address, signer2.address, signer3.address], 2);
  let reverted = false;
  try {
    await treasury2.depositFee(ethers.parseEther("1"));
  } catch (e) {
    reverted = true;
  }
  assert.equal(reverted, true, "deposit without allowance should have reverted");

  console.log("Treasury smoke test: ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error("Treasury smoke test FAILED:", e);
  process.exit(1);
});
