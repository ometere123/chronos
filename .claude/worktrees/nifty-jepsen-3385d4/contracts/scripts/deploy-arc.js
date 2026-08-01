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

  console.log("\n1. Deploying Treasury...");
  const treasury = await viem.deployContract("Treasury", [
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

  const usdcAddress = process.env.ARC_USDC || "0x3600000000000000000000000000000000000000";

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

  console.log("\n7. Setting up connections...");
  const tx1 = await timeLockVault.write.setBridgeOrchestrator([bridgeOrchestrator.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });
  console.log("✓ TimeLockVault bridge orchestrator set");

  const cctpTokenMessenger =
    process.env.ARC_CCTP_TOKEN_MESSENGER || process.env.CCTP_TOKEN_MESSENGER;
  const cctpMessageTransmitter =
    process.env.ARC_CCTP_MESSAGE_TRANSMITTER || process.env.CCTP_MESSAGE_TRANSMITTER;

  if (cctpTokenMessenger && cctpMessageTransmitter) {
    const tx2 = await bridgeOrchestrator.write.configureCCTP([
      cctpTokenMessenger,
      cctpMessageTransmitter,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx2 });
    console.log("✓ BridgeOrchestrator CCTP configured");
    console.log("  Token Messenger:", cctpTokenMessenger);
    console.log("  Message Transmitter:", cctpMessageTransmitter);
  } else {
    console.log("⚠ CCTP not configured (set ARC_CCTP_TOKEN_MESSENGER and ARC_CCTP_MESSAGE_TRANSMITTER in .env)");
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
  console.log("\nAdd to .env.local:");
  console.log("ARC_TREASURY_ADDRESS=" + treasury.address);
  console.log("ARC_TIMELOCK_VAULT_ADDRESS=" + timeLockVault.address);
  console.log("ARC_VAULT_FACTORY_ADDRESS=" + vaultFactory.address);
  console.log("ARC_BRIDGE_ORCHESTRATOR_ADDRESS=" + bridgeOrchestrator.address);
  console.log("ARC_PROOF_OF_RESERVES_ADDRESS=" + proofOfReserves.address);
  console.log("ARC_GOVERNANCE_TIMELOCK_ADDRESS=" + governanceTimelock.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
