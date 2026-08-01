// Smoke test for live on-chain proof-of-reserves (Item 2).
// Runs against the in-memory Hardhat network via viem. Uses node:assert instead of
// hardhat-chai-matchers, which does not work under this Hardhat 3 + node:test setup.
//
// Run with: npx hardhat run scripts/smoke-proof-of-reserves.js
import assert from "node:assert/strict";
import hre from "hardhat";

async function main() {
  const networkConnection = await hre.network.connect();
  const { viem } = networkConnection;
  const publicClient = await viem.getPublicClient();
  const [deployer, user1, user2] = await viem.getWalletClients();

  console.log("Deploying contracts...");
  const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 1_000_000_000_000n]);
  const treasury = await viem.deployContract("Treasury", [
    [deployer.account.address, user1.account.address, user2.account.address],
    2n,
  ]);
  const timeLockVault = await viem.deployContract("TimeLockVault", [treasury.address]);
  const vaultFactory = await viem.deployContract("VaultFactory", [timeLockVault.address]);
  const proofOfReserves = await viem.deployContract("ProofOfReserves", [
    timeLockVault.address,
    vaultFactory.address,
    usdc.address,
  ]);

  // Use deployer as the "bridge orchestrator" so we can create vaults directly in this smoke test.
  let tx = await timeLockVault.write.setBridgeOrchestrator([deployer.account.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const now = Math.floor(Date.now() / 1000);
  const unlockAt1 = BigInt(now + 3600);
  const unlockAt2 = BigInt(now + 7200);

  const amount1 = 100_000_000n; // 100 USDC (6 decimals)
  const amount2 = 250_000_000n; // 250 USDC

  // Fund the TimeLockVault contract with real USDC, simulating bridge-credited deposits.
  tx = await usdc.write.transfer([timeLockVault.address, amount1 + amount2]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  // --- Assertion 1: with zero vaults created, live active-locked sum is 0 ---
  let liveActive = await proofOfReserves.read.getLiveActiveLocked();
  assert.equal(liveActive, 0n, `expected 0 active locked before any vaults, got ${liveActive}`);
  console.log("PASS: getLiveActiveLocked() == 0 before any vault exists");

  // --- Create two active vaults ---
  tx = await timeLockVault.write.depositFromBridge([
    amount1,
    user1.account.address,
    unlockAt1,
    84532,
    0,
    usdc.address,
    0, // FIXED
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await timeLockVault.write.depositFromBridge([
    amount2,
    user2.account.address,
    unlockAt2,
    84532,
    0,
    usdc.address,
    0, // FIXED
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  // --- Assertion 2: live sum equals sum of both active vaults, read directly from TimeLockVault ---
  liveActive = await proofOfReserves.read.getLiveActiveLocked();
  assert.equal(
    liveActive,
    amount1 + amount2,
    `expected live active locked == ${amount1 + amount2}, got ${liveActive}`
  );
  console.log(`PASS: getLiveActiveLocked() == ${liveActive} after 2 deposits (sum of ${amount1} + ${amount2})`);

  // --- Assertion 3: verifyLiveReserves() view matches USDC.balanceOf(TimeLockVault) and is fully reserved ---
  const [usdcBalance, activeLocked, activeVaultCount, fullyReserved] =
    await proofOfReserves.read.verifyLiveReserves();

  const actualBalance = await usdc.read.balanceOf([timeLockVault.address]);
  assert.equal(usdcBalance, actualBalance, "usdcBalance should equal USDC.balanceOf(TimeLockVault)");
  assert.equal(activeLocked, amount1 + amount2, "activeLocked mismatch");
  assert.equal(activeVaultCount, 2n, "activeVaultCount mismatch");
  assert.equal(fullyReserved, true, "should be fully reserved (balance >= locked)");
  console.log("PASS: verifyLiveReserves() matches real USDC.balanceOf(TimeLockVault) and reports fullyReserved=true");

  // --- Assertion 4: claiming a vault removes it from the live active sum ---
  await publicClient.request({ method: "evm_increaseTime", params: [3700] });
  await publicClient.request({ method: "evm_mine", params: [] });

  const vaultIds = await timeLockVault.read.getAllVaultIds();
  const vault1Id = vaultIds[0];
  const user1Client = await viem.getWalletClients().then((clients) => clients[1]);
  const timeLockVaultAsUser1 = await viem.getContractAt("TimeLockVault", timeLockVault.address, {
    client: { wallet: user1Client },
  });
  tx = await timeLockVaultAsUser1.write.claimVault([vault1Id, 84532]);
  await publicClient.waitForTransactionReceipt({ hash: tx });

  liveActive = await proofOfReserves.read.getLiveActiveLocked();
  assert.equal(liveActive, amount2, `expected live active locked == ${amount2} after claiming vault1, got ${liveActive}`);
  console.log(`PASS: getLiveActiveLocked() correctly drops to ${liveActive} after a claim (CLAIMED vaults excluded)`);

  console.log("\nAll proof-of-reserves smoke assertions passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
