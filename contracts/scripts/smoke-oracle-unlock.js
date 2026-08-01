// Smoke test suite for oracle-gated unlock (Item 5) and the treasury-balance guard (Item 6).
// node:assert style (chai-matchers broken under this Hardhat 3 + node:test setup) -
// see scripts/smoke-credit-line.js for the pattern.
//
// Covers:
//  - claim blocked when oracle condition unmet (price below threshold, "above" mode)
//  - claim succeeds once price crosses threshold, "above" mode
//  - claim blocked/succeeds analogously for "below" mode
//  - vaults without any condition set are unaffected (backward compatible, uses depositFromBridge)
//  - claim blocked when treasury balance condition unmet even though oracle+time are satisfied
//  - claim succeeds once treasury balance crosses threshold
//
// Run with: npx hardhat run scripts/smoke-oracle-unlock.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function deployBase(viem, deployer) {
  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 10_000_000_000_000n]);
  const treasury = await viem.deployContract("Treasury", [
    usdc.address,
    [deployer.account.address, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
    2n,
  ]);
  const timeLockVault = await viem.deployContract("TimeLockVault", [treasury.address]);
  const oracle = await viem.deployContract("MockPriceOracle", [0n]);

  return { usdc, treasury, timeLockVault, oracle };
}

async function expectRevert(promiseFn, substring, label) {
  let reverted = false;
  let message = "";
  try {
    const tx = await promiseFn();
    if (tx && tx.wait) await tx.wait();
  } catch (err) {
    message = String(err.message || err);
    reverted = message.includes(substring);
  }
  assert.equal(reverted, true, `${label}: expected revert containing "${substring}", got: ${message}`);
}

async function main() {
  const networkConnection = await hre.network.connect();
  const { viem } = networkConnection;
  const publicClient = await viem.getPublicClient();
  const [deployer, owner] = await viem.getWalletClients();

  // =====================================================================
  // Scenario 1: oracle condition, "above" mode - blocked then unblocked
  // =====================================================================
  console.log("\n--- Scenario 1: oracle-gated unlock, price must be >= threshold ---");
  {
    const { usdc, timeLockVault, oracle } = await deployBase(viem, deployer);
    let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const latestBlock = await publicClient.getBlock();
    const unlockAt = latestBlock.timestamp + 10n; // matures quickly

    const amount = 1_000_000_000n; // 1000 USDC
    tx = await usdc.write.transfer([timeLockVault.address, amount]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    tx = await timeLockVault.write.depositFromBridgeAdvanced([{
      amount,
      owner: owner.account.address,
      unlockAt,
      sourceChain: 84532,
      bridgeProtocol: 0,
      tokenAddress: usdc.address,
      vaultType: 0, // FIXED
      conditionOracle: oracle.address,
      conditionThreshold: 100n, // price must be >= 100
      conditionAbove: true,
      treasuryBalanceCheck: "0x0000000000000000000000000000000000000000",
      treasuryBalanceThreshold: 0n,
      numTranches: 0,
      intervalSeconds: 0,
    }]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const vaultIds = await timeLockVault.read.getAllVaultIds();
    const vaultId = vaultIds[vaultIds.length - 1];

    // Warp past unlockAt so only the oracle condition is what's blocking.
    await publicClient.request({ method: "evm_increaseTime", params: [20] });
    await publicClient.request({ method: "evm_mine", params: [] });

    // Price still 0 (< 100) -> claim must be blocked despite time maturity.
    const vaultAsOwner = await viem.getContractAt("TimeLockVault", timeLockVault.address, { client: { wallet: owner } });
    await expectRevert(
      () => vaultAsOwner.write.claimVault([vaultId, 84532]),
      "Unlock conditions not met",
      "claim blocked, price below threshold (above mode)"
    );
    console.log("PASS: claim blocked while oracle price (0) is below the >= 100 threshold");

    // Push price up to cross threshold.
    tx = await oracle.write.setPrice([150n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimVault([vaultId, 84532]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const balAfter = await usdc.read.balanceOf([owner.account.address]);
    assert.equal(balAfter - balBefore, amount, "owner should receive full deposit once price crosses threshold");
    console.log("PASS: claim succeeds once oracle price (150) crosses the >= 100 threshold");
  }

  // =====================================================================
  // Scenario 2: oracle condition, "below" mode - blocked then unblocked
  // =====================================================================
  console.log("\n--- Scenario 2: oracle-gated unlock, price must be <= threshold ---");
  {
    const { usdc, timeLockVault, oracle } = await deployBase(viem, deployer);
    let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await oracle.write.setPrice([500n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const latestBlock = await publicClient.getBlock();
    const unlockAt = latestBlock.timestamp + 10n;

    const amount = 500_000_000n;
    tx = await usdc.write.transfer([timeLockVault.address, amount]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    tx = await timeLockVault.write.depositFromBridgeAdvanced([{
      amount,
      owner: owner.account.address,
      unlockAt,
      sourceChain: 84532,
      bridgeProtocol: 0,
      tokenAddress: usdc.address,
      vaultType: 0,
      conditionOracle: oracle.address,
      conditionThreshold: 200n, // price must be <= 200
      conditionAbove: false,
      treasuryBalanceCheck: "0x0000000000000000000000000000000000000000",
      treasuryBalanceThreshold: 0n,
      numTranches: 0,
      intervalSeconds: 0,
    }]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const vaultIds = await timeLockVault.read.getAllVaultIds();
    const vaultId = vaultIds[vaultIds.length - 1];

    await publicClient.request({ method: "evm_increaseTime", params: [20] });
    await publicClient.request({ method: "evm_mine", params: [] });

    const vaultAsOwner = await viem.getContractAt("TimeLockVault", timeLockVault.address, { client: { wallet: owner } });
    await expectRevert(
      () => vaultAsOwner.write.claimVault([vaultId, 84532]),
      "Unlock conditions not met",
      "claim blocked, price above threshold (below mode)"
    );
    console.log("PASS: claim blocked while oracle price (500) is above the <= 200 threshold");

    tx = await oracle.write.setPrice([150n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimVault([vaultId, 84532]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const balAfter = await usdc.read.balanceOf([owner.account.address]);
    assert.equal(balAfter - balBefore, amount, "owner should receive full deposit once price drops to/below threshold");
    console.log("PASS: claim succeeds once oracle price (150) drops to/below the <= 200 threshold");
  }

  // =====================================================================
  // Scenario 3: backward compatibility - vaults without any condition
  // =====================================================================
  console.log("\n--- Scenario 3: vaults without a condition are unaffected ---");
  {
    const { usdc, timeLockVault } = await deployBase(viem, deployer);
    let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const latestBlock = await publicClient.getBlock();
    const unlockAt = latestBlock.timestamp + 10n;
    const amount = 300_000_000n;

    tx = await usdc.write.transfer([timeLockVault.address, amount]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    // Plain depositFromBridge (unchanged signature) - conditions default to disabled.
    tx = await timeLockVault.write.depositFromBridge([amount, owner.account.address, unlockAt, 84532, 0, usdc.address, 0]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const vaultIds = await timeLockVault.read.getAllVaultIds();
    const vaultId = vaultIds[vaultIds.length - 1];

    const stillMet = await timeLockVault.read.conditionsMet([vaultId]);
    assert.equal(stillMet, true, "vault with no condition set should report conditionsMet == true");
    console.log("PASS: conditionsMet() == true for a vault created without any condition");

    await publicClient.request({ method: "evm_increaseTime", params: [20] });
    await publicClient.request({ method: "evm_mine", params: [] });

    const vaultAsOwner = await viem.getContractAt("TimeLockVault", timeLockVault.address, { client: { wallet: owner } });
    const balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimVault([vaultId, 84532]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const balAfter = await usdc.read.balanceOf([owner.account.address]);
    assert.equal(balAfter - balBefore, amount, "claim should succeed normally once matured, no condition involved");
    console.log("PASS: plain depositFromBridge vault claims normally once matured (backward compatible)");
  }

  // =====================================================================
  // Scenario 4 (Item 6): treasury-balance guard blocks then unblocks claim
  // =====================================================================
  console.log("\n--- Scenario 4: treasury-balance guard, AND'd with oracle + time ---");
  {
    const { usdc, treasury, timeLockVault, oracle } = await deployBase(viem, deployer);
    let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await oracle.write.setPrice([1000n]); // oracle condition satisfied from the start
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const latestBlock = await publicClient.getBlock();
    const unlockAt = latestBlock.timestamp + 10n;
    const amount = 400_000_000n;

    tx = await usdc.write.transfer([timeLockVault.address, amount]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    tx = await timeLockVault.write.depositFromBridgeAdvanced([{
      amount,
      owner: owner.account.address,
      unlockAt,
      sourceChain: 84532,
      bridgeProtocol: 0,
      tokenAddress: usdc.address,
      vaultType: 0,
      conditionOracle: oracle.address,
      conditionThreshold: 500n, // price (1000) already >= 500, satisfied
      conditionAbove: true,
      treasuryBalanceCheck: treasury.address,
      treasuryBalanceThreshold: 1_000_000_000n, // treasury must hold >= 1000 USDC
      numTranches: 0,
      intervalSeconds: 0,
    }]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const vaultIds = await timeLockVault.read.getAllVaultIds();
    const vaultId = vaultIds[vaultIds.length - 1];

    await publicClient.request({ method: "evm_increaseTime", params: [20] });
    await publicClient.request({ method: "evm_mine", params: [] });

    const treasuryBalBefore = await treasury.read.getUsdcBalance();
    assert.equal(treasuryBalBefore, 0n, "treasury starts empty in this scenario");

    const vaultAsOwner = await viem.getContractAt("TimeLockVault", timeLockVault.address, { client: { wallet: owner } });
    await expectRevert(
      () => vaultAsOwner.write.claimVault([vaultId, 84532]),
      "Unlock conditions not met",
      "claim blocked, treasury balance below threshold despite oracle+time satisfied"
    );
    console.log("PASS: claim blocked while treasury balance (0) is below the 1000 USDC threshold, even though oracle+time are met");

    // Fund the treasury directly (simulate fee deposits reaching the required balance).
    tx = await usdc.write.transfer([treasury.address, 1_000_000_000n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const treasuryBalAfter = await treasury.read.getUsdcBalance();
    assert.equal(treasuryBalAfter, 1_000_000_000n, "treasury should now hold exactly the threshold amount");

    const balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimVault([vaultId, 84532]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const balAfter = await usdc.read.balanceOf([owner.account.address]);
    assert.equal(balAfter - balBefore, amount, "claim should succeed once treasury balance crosses threshold");
    console.log("PASS: claim succeeds once treasury balance (1000 USDC) reaches the required threshold");
  }

  console.log("\nAll oracle-unlock / treasury-guard smoke assertions passed across 4 scenarios.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
