import hre from "hardhat";

// Redeploys ONLY TimeLockVault (to pick up the delegate-to-agent functions that were written in
// source but never deployed - see docs/HANDOVER for context) and the contracts that must be
// re-wired to point at it (VaultFactory, BridgeOrchestrator, ProofOfReserves, CreditLine).
// Treasury, GovernanceTimelock, ScheduledPayment, and the price oracles are untouched and reused
// as-is since nothing about them changed.
async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "arcTestnet";
  const networkConnection = await hre.network.create({ network: networkName });
  const { viem } = networkConnection;
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const deployerAddress = walletClient?.account?.address;

  if (!deployerAddress) {
    throw new Error("No deployer account available for this network");
  }

  const usdcAddress = process.env.ARC_USDC || "0x3600000000000000000000000000000000000000";
  const treasuryAddress = process.env.ARC_TREASURY_ADDRESS;
  if (!treasuryAddress) {
    throw new Error("ARC_TREASURY_ADDRESS env var not set - reused from the existing deployment");
  }

  console.log("Redeploying TimeLockVault (+ dependents) to Arc Testnet...");
  console.log("Deployer address:", deployerAddress);
  console.log("Reusing Treasury:", treasuryAddress);

  console.log("\n1. Deploying new TimeLockVault...");
  const timeLockVault = await viem.deployContract("TimeLockVault", [treasuryAddress]);
  console.log("TimeLockVault deployed to:", timeLockVault.address);

  console.log("\n2. Deploying new VaultFactory...");
  const vaultFactory = await viem.deployContract("VaultFactory", [timeLockVault.address]);
  console.log("VaultFactory deployed to:", vaultFactory.address);

  console.log("\n3. Deploying new BridgeOrchestrator...");
  const bridgeOrchestrator = await viem.deployContract("BridgeOrchestrator", [
    timeLockVault.address,
    usdcAddress,
  ]);
  console.log("BridgeOrchestrator deployed to:", bridgeOrchestrator.address);

  console.log("\n4. Deploying new ProofOfReserves...");
  const proofOfReserves = await viem.deployContract("ProofOfReserves", [
    timeLockVault.address,
    vaultFactory.address,
    usdcAddress,
  ]);
  console.log("ProofOfReserves deployed to:", proofOfReserves.address);

  console.log("\n5. Deploying new CreditLine...");
  const creditLine = await viem.deployContract("CreditLine", [usdcAddress, timeLockVault.address]);
  console.log("CreditLine deployed to:", creditLine.address);

  console.log("\n6. Wiring cross-contract references...");
  const tx1 = await timeLockVault.write.setBridgeOrchestrator([bridgeOrchestrator.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });
  console.log("  TimeLockVault.bridgeOrchestrator set");

  const tx2 = await timeLockVault.write.setCreditLine([creditLine.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx2 });
  console.log("  TimeLockVault.creditLine set");

  const cctpTokenMessenger =
    process.env.ARC_CCTP_TOKEN_MESSENGER || process.env.CCTP_TOKEN_MESSENGER;
  const cctpMessageTransmitter =
    process.env.ARC_CCTP_MESSAGE_TRANSMITTER || process.env.CCTP_MESSAGE_TRANSMITTER;

  if (cctpTokenMessenger && cctpMessageTransmitter) {
    const tx3 = await bridgeOrchestrator.write.configureCCTP([
      cctpTokenMessenger,
      cctpMessageTransmitter,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx3 });
    console.log("  BridgeOrchestrator CCTP configured");
  } else {
    console.log("  WARNING: CCTP not configured (set ARC_CCTP_TOKEN_MESSENGER / ARC_CCTP_MESSAGE_TRANSMITTER)");
  }

  console.log("\n========================================");
  console.log("TimeLockVault Redeployment Complete!");
  console.log("========================================");
  console.log("\nUpdated addresses:");
  console.log("ARC_TIMELOCK_VAULT_ADDRESS=" + timeLockVault.address);
  console.log("ARC_VAULT_FACTORY_ADDRESS=" + vaultFactory.address);
  console.log("ARC_BRIDGE_ORCHESTRATOR_ADDRESS=" + bridgeOrchestrator.address);
  console.log("ARC_PROOF_OF_RESERVES_ADDRESS=" + proofOfReserves.address);
  console.log("ARC_CREDIT_LINE_ADDRESS=" + creditLine.address);
  console.log("\nUnchanged (reused):");
  console.log("ARC_TREASURY_ADDRESS=" + treasuryAddress);
  console.log("ARC_SCHEDULED_PAYMENT_ADDRESS=" + (process.env.ARC_SCHEDULED_PAYMENT_ADDRESS || "(unchanged)"));
  console.log("ARC_GOVERNANCE_TIMELOCK_ADDRESS=" + (process.env.ARC_GOVERNANCE_TIMELOCK_ADDRESS || "(unchanged)"));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
