import hre from "hardhat";

function logEnvValue(label, value) {
  console.log(`  ${label}:`, value || "NOT SET");
}

function normalizeAddress(value) {
  return value ? value.trim().toLowerCase() : value;
}

async function main() {
  const networkConnection = await hre.network.create();
  const { viem } = networkConnection;
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const deployerAddress = walletClient?.account?.address;

  if (!deployerAddress) {
    throw new Error("No deployer account available for this network");
  }

  console.log(`\nDeploying CCTP Receiver to ${networkConnection.networkName}...`);
  console.log("Deployer address:", deployerAddress);

  let config;

  switch (networkConnection.networkName) {
    case "baseSepoliaTestnet":
      config = {
        name: "Base Sepolia",
        cctpTokenMessenger: process.env.BASE_SEPOLIA_CCTP_TOKEN_MESSENGER,
        cctpMessageTransmitter: process.env.BASE_SEPOLIA_CCTP_MESSAGE_TRANSMITTER,
        usdcAddress: process.env.BASE_SEPOLIA_USDC,
        domain: process.env.BASE_SEPOLIA_CCTP_DOMAIN,
        envKey: "BASE_SEPOLIA_CCTP_RECEIVER_ADDRESS",
      };
      break;
    case "arbitrumSepoliaTestnet":
      config = {
        name: "Arbitrum Sepolia",
        cctpTokenMessenger: process.env.ARBITRUM_SEPOLIA_CCTP_TOKEN_MESSENGER,
        cctpMessageTransmitter: process.env.ARBITRUM_SEPOLIA_CCTP_MESSAGE_TRANSMITTER,
        usdcAddress: process.env.ARBITRUM_SEPOLIA_USDC,
        domain: process.env.ARBITRUM_SEPOLIA_CCTP_DOMAIN,
        envKey: "ARBITRUM_SEPOLIA_CCTP_RECEIVER_ADDRESS",
      };
      break;
    case "ethereumSepoliaTestnet":
      config = {
        name: "Ethereum Sepolia",
        cctpTokenMessenger: process.env.ETHEREUM_SEPOLIA_CCTP_TOKEN_MESSENGER,
        cctpMessageTransmitter: process.env.ETHEREUM_SEPOLIA_CCTP_MESSAGE_TRANSMITTER,
        usdcAddress: process.env.ETHEREUM_SEPOLIA_USDC,
        domain: process.env.ETHEREUM_SEPOLIA_CCTP_DOMAIN,
        envKey: "ETHEREUM_SEPOLIA_CCTP_RECEIVER_ADDRESS",
      };
      break;
    case "opSepoliaTestnet":
      config = {
        name: "OP Sepolia",
        cctpTokenMessenger: process.env.OP_SEPOLIA_CCTP_TOKEN_MESSENGER,
        cctpMessageTransmitter: process.env.OP_SEPOLIA_CCTP_MESSAGE_TRANSMITTER,
        usdcAddress: process.env.OP_SEPOLIA_USDC,
        domain: process.env.OP_SEPOLIA_CCTP_DOMAIN,
        envKey: "OP_SEPOLIA_CCTP_RECEIVER_ADDRESS",
      };
      break;
    default:
      throw new Error(`Unsupported network: ${networkConnection.networkName}`);
  }

  console.log("\nReading env values:");
  config.cctpTokenMessenger = normalizeAddress(config.cctpTokenMessenger);
  config.cctpMessageTransmitter = normalizeAddress(config.cctpMessageTransmitter);
  config.usdcAddress = normalizeAddress(config.usdcAddress);
  const arcBridgeAddress = normalizeAddress(process.env.ARC_BRIDGE_ORCHESTRATOR_ADDRESS);

  logEnvValue(`${config.name} CCTP Token Messenger`, config.cctpTokenMessenger);
  logEnvValue(`${config.name} CCTP Message Transmitter`, config.cctpMessageTransmitter);
  logEnvValue(`${config.name} USDC`, config.usdcAddress);
  logEnvValue(`${config.name} CCTP Domain`, config.domain);
  logEnvValue("ARC_BRIDGE_ORCHESTRATOR_ADDRESS", arcBridgeAddress);

  if (!config.cctpTokenMessenger || !config.cctpMessageTransmitter || !config.usdcAddress) {
    throw new Error(`Missing CCTP configuration for ${config.name}. Check your .env file.`);
  }
  if (!arcBridgeAddress) {
    console.warn("Warning: ARC_BRIDGE_ORCHESTRATOR_ADDRESS not set. Deploy Arc contracts first!");
  }

  console.log("\nConfiguration:");
  console.log("  Chain:", config.name);
  console.log("  CCTP Domain:", config.domain);
  console.log("  Token Messenger:", config.cctpTokenMessenger);
  console.log("  Message Transmitter:", config.cctpMessageTransmitter);
  console.log("  USDC Address:", config.usdcAddress);
  console.log("  Arc Bridge Address:", arcBridgeAddress || "NOT SET");

  console.log("\nDeploying CCTPReceiver...");
  const cctpReceiver = await viem.deployContract("CCTPReceiver", [
    config.cctpMessageTransmitter,
    config.cctpTokenMessenger,
    arcBridgeAddress || "0x0000000000000000000000000000000000000000",
    config.usdcAddress,
  ]);

  console.log("CCTPReceiver deployed to:", cctpReceiver.address);

  if (arcBridgeAddress) {
    const tx = await cctpReceiver.write.setArcBridgeAddress([arcBridgeAddress]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log("Arc bridge address set on receiver");
  }

  console.log("\n" + "=".repeat(50));
  console.log(`${config.name} Deployment Complete!`);
  console.log("=".repeat(50));
  console.log("\nAdd to .env.local:");
  console.log(`${config.envKey}=${cctpReceiver.address}`);
  console.log("\nIf you haven't deployed Arc contracts yet, you'll need to:");
  console.log("1. Run: npm run deploy:arc");
  console.log("2. Copy ARC_BRIDGE_ORCHESTRATOR_ADDRESS to .env.local");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
