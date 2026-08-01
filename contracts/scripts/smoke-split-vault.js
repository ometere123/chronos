// Smoke test for Smart Treasury Vaults / split deposits (Item 3).
// node:assert style (no chai matchers) - see scripts/smoke-proof-of-reserves.js for rationale.
//
// Run with: npx hardhat run scripts/smoke-split-vault.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const networkConnection = await hre.network.connect();
  const { viem } = networkConnection;
  const publicClient = await viem.getPublicClient();
  const [deployer, user1] = await viem.getWalletClients();

  console.log("Deploying contracts...");
  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 1_000_000_000_000n]);
  const treasury = await viem.deployContract("Treasury", [
    [deployer.account.address, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
    2n,
  ]);
  const timeLockVault = await viem.deployContract("TimeLockVault", [treasury.address]);

  let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const depositAmount = 1_000_000_000n; // 1000 USDC (6 decimals)
  tx = await usdc.write.transfer([timeLockVault.address, depositAmount]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const now = Math.floor(Date.now() / 1000);
  const unlockAt = BigInt(now + 3600);

  // --- Reject a split that doesn't sum to 10000 bps ---
  let rejected = false;
  try {
    tx = await timeLockVault.write.depositFromBridgeSplit([
      {
        amount: depositAmount,
        owner: user1.account.address,
        unlockAt,
        sourceChain: 84532,
        bridgeProtocol: 0,
        tokenAddress: usdc.address,
        vaultType: 0,
        savingsBps: 5000,
        yieldBps: 3000,
        reserveBps: 1000, // sums to 9000, invalid
      },
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    rejected = String(err.message || err).includes("Split bps must sum to 10000");
  }
  assert.equal(rejected, true, "expected split creation to revert on invalid bps sum");
  console.log("PASS: split vault creation rejected when bps do not sum to 10000");

  // --- Create a valid 50/30/20 split vault ---
  const savingsBps = 5000;
  const yieldBps = 3000;
  const reserveBps = 2000;

  tx = await timeLockVault.write.depositFromBridgeSplit([
    {
      amount: depositAmount,
      owner: user1.account.address,
      unlockAt,
      sourceChain: 84532,
      bridgeProtocol: 0,
      tokenAddress: usdc.address,
      vaultType: 0,
      savingsBps,
      yieldBps,
      reserveBps,
    },
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const vaultIds = await timeLockVault.read.getAllVaultIds();
  const vaultId = vaultIds[vaultIds.length - 1];

  const config = await timeLockVault.read.getSplitConfig([vaultId]);
  assert.equal(config.isSplit, true, "expected isSplit=true");
  assert.equal(config.savingsBps, savingsBps);
  assert.equal(config.yieldBps, yieldBps);
  assert.equal(config.reserveBps, reserveBps);
  console.log("PASS: split config persisted correctly on-chain");

  const buckets = await timeLockVault.read.getSplitBuckets([vaultId]);
  const [savingsAmt, yieldAmt, reserveAmt] = buckets;
  const expectedSavings = (depositAmount * BigInt(savingsBps)) / 10000n;
  const expectedYield = (depositAmount * BigInt(yieldBps)) / 10000n;
  const expectedReserve = depositAmount - expectedSavings - expectedYield;

  assert.equal(savingsAmt, expectedSavings, "savings bucket mismatch");
  assert.equal(yieldAmt, expectedYield, "yield bucket mismatch");
  assert.equal(reserveAmt, expectedReserve, "reserve bucket mismatch");
  assert.equal(savingsAmt + yieldAmt + reserveAmt, depositAmount, "buckets must sum exactly to deposit");
  console.log(`PASS: buckets (${savingsAmt}, ${yieldAmt}, ${reserveAmt}) sum exactly to deposit ${depositAmount}`);

  // --- Claiming before maturity must fail ---
  const user1WalletClient = (await viem.getWalletClients())[1];
  const vaultAsUser1 = await viem.getContractAt("TimeLockVault", timeLockVault.address, {
    client: { wallet: user1WalletClient },
  });

  let claimedEarly = false;
  try {
    tx = await vaultAsUser1.write.claimBucket([vaultId, 0]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    claimedEarly = String(err.message || err).includes("Vault not mature");
  }
  assert.equal(claimedEarly, true, "expected early bucket claim to revert");
  console.log("PASS: bucket claim rejected before maturity");

  // --- Fast-forward past maturity and claim all three buckets ---
  await publicClient.request({ method: "evm_increaseTime", params: [3700] });
  await publicClient.request({ method: "evm_mine", params: [] });

  const balanceBefore = await usdc.read.balanceOf([user1.account.address]);

  for (const bucket of [0, 1, 2]) {
    tx = await vaultAsUser1.write.claimBucket([vaultId, bucket]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  const balanceAfter = await usdc.read.balanceOf([user1.account.address]);
  const totalClaimed = balanceAfter - balanceBefore;
  assert.equal(totalClaimed, depositAmount, `expected total claimed across buckets == deposit (${depositAmount}), got ${totalClaimed}`);
  console.log(`PASS: sum of per-bucket claims (${totalClaimed}) == original deposit (${depositAmount})`);

  // --- Vault should now be fully CLAIMED and double-claim should revert ---
  const vault = await timeLockVault.read.getVault([vaultId]);
  assert.equal(vault.status, 2, "expected vault status CLAIMED (2) after all buckets claimed");
  console.log("PASS: vault status flips to CLAIMED once all three buckets are claimed");

  let doubleClaimed = false;
  try {
    tx = await vaultAsUser1.write.claimBucket([vaultId, 0]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    doubleClaimed = String(err.message || err).includes("Vault not active") || String(err.message || err).includes("Bucket already claimed");
  }
  assert.equal(doubleClaimed, true, "expected double-claim on same bucket to revert");
  console.log("PASS: double-claim on an already-claimed bucket rejected");

  console.log("\nAll split-vault smoke assertions passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
