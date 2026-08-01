import hre from "hardhat";

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

  console.log("Deploying contracts to Arc Testnet...");
  console.log("Deployer address:", deployerAddress);

  const usdcAddress = process.env.ARC_USDC || "0x3600000000000000000000000000000000000000";
  if (!usdcAddress) {
    throw new Error("ARC_USDC env var not set");
  }

  console.log("\n1. Deploying Treasury...");
  const treasury = await viem.deployContract("Treasury", [
    usdcAddress,
    [deployerAddress, "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
    2n,
  ]);
  console.log("Treasury deployed to:", treasury.address);

  console.log("\n2. Deploying TimeLockVault...");
  const timeLockVault = await viem.deployContract("TimeLockVault", [treasury.address]);
  console.log("TimeLockVault deployed to:", timeLockVault.address);

  console.log("\n3. Deploying VaultFactory...");
  const vaultFactory = await viem.deployContract("VaultFactory", [timeLockVault.address]);
  console.log("VaultFactory deployed to:", vaultFactory.address);

  console.log("\n4. Deploying BridgeOrchestrator...");
  const bridgeOrchestrator = await viem.deployContract("BridgeOrchestrator", [
    timeLockVault.address,
    usdcAddress,
  ]);
  console.log("BridgeOrchestrator deployed to:", bridgeOrchestrator.address);

  console.log("\n5. Deploying ProofOfReserves...");
  const proofOfReserves = await viem.deployContract("ProofOfReserves", [
    timeLockVault.address,
    vaultFactory.address,
    usdcAddress,
  ]);
  console.log("ProofOfReserves deployed to:", proofOfReserves.address);

  console.log("\n6. Deploying GovernanceTimelock...");
  const governanceTimelock = await viem.deployContract("GovernanceTimelock", []);
  console.log("GovernanceTimelock deployed to:", governanceTimelock.address);

  console.log("\n7. Deploying CreditLine...");
  const creditLine = await viem.deployContract("CreditLine", [usdcAddress, timeLockVault.address]);
  console.log("CreditLine deployed to:", creditLine.address);

  console.log("\n8. Deploying ScheduledPayment...");
  const scheduledPayment = await viem.deployContract("ScheduledPayment", [treasury.address]);
  console.log("ScheduledPayment deployed to:", scheduledPayment.address);

  console.log("\n9. Deploying MockPriceOracle (DEMO MOCK - replace with a real Arc oracle when available)...");
  // Initial price: 1.00 with 8 decimals, matching common AggregatorV3-style feed conventions.
  const mockPriceOracle = await viem.deployContract("MockPriceOracle", [100_000_000n]);
  console.log("MockPriceOracle deployed to:", mockPriceOracle.address);

  console.log("\n10. Wiring cross-contract references...");
  const tx1 = await timeLockVault.write.setBridgeOrchestrator([bridgeOrchestrator.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });
  console.log("  TimeLockVault.bridgeOrchestrator set");

  const tx2 = await timeLockVault.write.setCreditLine([creditLine.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx2 });
  console.log("  TimeLockVault.creditLine set");

  const tx3 = await treasury.write.setScheduledPaymentAddress([scheduledPayment.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx3 });
  console.log("  Treasury.scheduledPaymentAddress set");

  const cctpTokenMessenger =
    process.env.ARC_CCTP_TOKEN_MESSENGER || process.env.CCTP_TOKEN_MESSENGER;
  const cctpMessageTransmitter =
    process.env.ARC_CCTP_MESSAGE_TRANSMITTER || process.env.CCTP_MESSAGE_TRANSMITTER;

  if (cctpTokenMessenger && cctpMessageTransmitter) {
    const tx4 = await bridgeOrchestrator.write.configureCCTP([
      cctpTokenMessenger,
      cctpMessageTransmitter,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx4 });
    console.log("  BridgeOrchestrator CCTP configured");
    console.log("    Token Messenger:", cctpTokenMessenger);
    console.log("    Message Transmitter:", cctpMessageTransmitter);
  } else {
    console.log("  WARNING: CCTP not configured (set ARC_CCTP_TOKEN_MESSENGER / ARC_CCTP_MESSAGE_TRANSMITTER)");
  }

  console.log("\n========================================");
  console.log("Arc Testnet Deployment Complete!");
  console.log("========================================");
  console.log("\nContract Addresses:");
  console.log("Treasury:              ", treasury.address);
  console.log("TimeLockVault:         ", timeLockVault.address);
  console.log("VaultFactory:          ", vaultFactory.address);
  console.log("BridgeOrchestrator:    ", bridgeOrchestrator.address);
  console.log("ProofOfReserves:       ", proofOfReserves.address);
  console.log("GovernanceTimelock:    ", governanceTimelock.address);
  console.log("CreditLine:            ", creditLine.address);
  console.log("ScheduledPayment:      ", scheduledPayment.address);
  console.log("MockPriceOracle:       ", mockPriceOracle.address);
  console.log("\nAdd/update in .env.local:");
  console.log("ARC_TREASURY_ADDRESS=" + treasury.address);
  console.log("ARC_TIMELOCK_VAULT_ADDRESS=" + timeLockVault.address);
  console.log("ARC_VAULT_FACTORY_ADDRESS=" + vaultFactory.address);
  console.log("ARC_BRIDGE_ORCHESTRATOR_ADDRESS=" + bridgeOrchestrator.address);
  console.log("ARC_PROOF_OF_RESERVES_ADDRESS=" + proofOfReserves.address);
  console.log("ARC_GOVERNANCE_TIMELOCK_ADDRESS=" + governanceTimelock.address);
  console.log("ARC_CREDIT_LINE_ADDRESS=" + creditLine.address);
  console.log("ARC_SCHEDULED_PAYMENT_ADDRESS=" + scheduledPayment.address);
  console.log("ARC_MOCK_PRICE_ORACLE_ADDRESS=" + mockPriceOracle.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
