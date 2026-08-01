// Smoke test suite for recurring/streaming vaults (Item 7).
// node:assert style - see scripts/smoke-credit-line.js for the pattern.
//
// Covers:
//  - no tranches claimable immediately after creation
//  - correct tranche count claimable after time warps (Hardhat evm_increaseTime)
//  - double-claim of the same (already-claimed) tranche window is rejected
//  - final claim releases exact remaining balance including rounding remainder
//  - total claimed across all tranches equals original deposit
//
// Run with: npx hardhat run scripts/smoke-streaming-vault.js
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
  return { usdc, treasury, timeLockVault };
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

  console.log("\n--- Streaming vault: 4 tranches, 30s interval, remainder handling ---");
  {
    const { usdc, timeLockVault } = await deployBase(viem, deployer);
    let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const latestBlock = await publicClient.getBlock();
    // totalAmount not evenly divisible by 4 to exercise the rounding-remainder path.
    const amount = 1_000_000_003n; // 1000.000003 USDC-ish
    const numTranches = 4;
    const intervalSeconds = 30n;
    // unlockAt is unused for maturity gating on streaming vaults but still required > now.
    const unlockAt = latestBlock.timestamp + 1000n;

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
      conditionOracle: "0x0000000000000000000000000000000000000000",
      conditionThreshold: 0n,
      conditionAbove: false,
      treasuryBalanceCheck: "0x0000000000000000000000000000000000000000",
      treasuryBalanceThreshold: 0n,
      numTranches,
      intervalSeconds,
    }]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const vaultIds = await timeLockVault.read.getAllVaultIds();
    const vaultId = vaultIds[vaultIds.length - 1];

    const vaultAsOwner = await viem.getContractAt("TimeLockVault", timeLockVault.address, { client: { wallet: owner } });

    // --- No tranches claimable immediately after creation ---
    const maturedAtStart = await timeLockVault.read.maturedTrancheCount([vaultId]);
    assert.equal(maturedAtStart, 0, "no tranches should be matured immediately after creation");
    await expectRevert(
      () => vaultAsOwner.write.claimStreamingTranches([vaultId]),
      "No new tranches matured",
      "claim immediately after creation"
    );
    console.log("PASS: no tranches claimable immediately after creation");

    const perTranche = amount / BigInt(numTranches); // 250000000
    let totalClaimed = 0n;

    // --- Warp past tranche 1 only ---
    await publicClient.request({ method: "evm_increaseTime", params: [31] });
    await publicClient.request({ method: "evm_mine", params: [] });

    let matured = await timeLockVault.read.maturedTrancheCount([vaultId]);
    assert.equal(matured, 1, "exactly 1 tranche should be matured after ~31s with a 30s interval");

    let balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimStreamingTranches([vaultId]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    let balAfter = await usdc.read.balanceOf([owner.account.address]);
    let claimed1 = balAfter - balBefore;
    assert.equal(claimed1, perTranche, "first tranche claim should equal amount/numTranches");
    totalClaimed += claimed1;
    console.log(`PASS: correct tranche (1) claimable and claimed (${claimed1}) after first time warp`);

    // --- Double-claim of the same (already-matured, already-claimed) window rejected ---
    await expectRevert(
      () => vaultAsOwner.write.claimStreamingTranches([vaultId]),
      "No new tranches matured",
      "double-claim same tranche window"
    );
    console.log("PASS: re-claiming with no newly-matured tranches is rejected (double-claim protection)");

    // --- Warp forward to mature tranches 2 and 3 together ---
    await publicClient.request({ method: "evm_increaseTime", params: [60] });
    await publicClient.request({ method: "evm_mine", params: [] });

    matured = await timeLockVault.read.maturedTrancheCount([vaultId]);
    assert.equal(matured, 3, "3 tranches should be matured after ~91s elapsed (3 x 30s intervals)");

    balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimStreamingTranches([vaultId]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    balAfter = await usdc.read.balanceOf([owner.account.address]);
    let claimed23 = balAfter - balBefore;
    assert.equal(claimed23, perTranche * 2n, "claiming 2 newly-matured tranches at once should pay out 2x perTranche");
    totalClaimed += claimed23;
    console.log(`PASS: correct tranche count (2 new tranches, total 3) claimable and claimed (${claimed23}) after second time warp`);

    // Vault should still be ACTIVE (not fully claimed yet).
    let vault = await timeLockVault.read.getVault([vaultId]);
    assert.equal(vault.status, 0, "vault should remain ACTIVE with 1 tranche still unclaimed");
    console.log("PASS: vault remains ACTIVE while final tranche is still outstanding");

    // --- Warp past final tranche and claim remainder ---
    await publicClient.request({ method: "evm_increaseTime", params: [40] });
    await publicClient.request({ method: "evm_mine", params: [] });

    matured = await timeLockVault.read.maturedTrancheCount([vaultId]);
    assert.equal(matured, 4, "all 4 tranches should be matured after full duration elapsed");

    const remainingBalance = amount - totalClaimed;
    const expectedFinal = remainingBalance; // final tranche absorbs rounding remainder
    balBefore = await usdc.read.balanceOf([owner.account.address]);
    tx = await vaultAsOwner.write.claimStreamingTranches([vaultId]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    balAfter = await usdc.read.balanceOf([owner.account.address]);
    let finalClaim = balAfter - balBefore;
    assert.equal(finalClaim, expectedFinal, "final claim should release exact remaining balance including rounding remainder");
    totalClaimed += finalClaim;
    console.log(`PASS: final claim (${finalClaim}) released exact remaining balance, including rounding remainder`);

    // --- Total claimed across all tranches equals original deposit ---
    assert.equal(totalClaimed, amount, "sum of all tranche claims must equal the original deposit exactly");
    console.log(`PASS: total claimed across all tranches (${totalClaimed}) == original deposit (${amount})`);

    vault = await timeLockVault.read.getVault([vaultId]);
    assert.equal(vault.status, 2, "vault should be marked CLAIMED once all tranches are claimed");
    console.log("PASS: vault status is CLAIMED once all tranches have been claimed");

    // Further claim attempts must revert (vault no longer ACTIVE).
    await expectRevert(
      () => vaultAsOwner.write.claimStreamingTranches([vaultId]),
      "Vault not active",
      "claim after full completion"
    );
    console.log("PASS: claiming again after full completion is rejected");
  }

  console.log("\nAll streaming-vault smoke assertions passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
