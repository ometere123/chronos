import hre from "hardhat";

const BAND_STDREFERENCE_ARC_TESTNET = "0x8c064bCf7C0DA3B3b090BAbFE8f3323534D84d68";

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "arcTestnet";
  const networkConnection = await hre.network.create({ network: networkName });
  const { viem } = networkConnection;

  console.log("Deploying BandOracleAdapter (USDC/USD) on Arc Testnet...");
  const adapter = await viem.deployContract("BandOracleAdapter", [
    BAND_STDREFERENCE_ARC_TESTNET,
    "USDC",
    "USD",
  ]);
  console.log("BandOracleAdapter deployed to:", adapter.address);

  const price = await adapter.read.getPrice();
  console.log("Live USDC/USD rate (18 decimals):", price.toString());

  console.log("\nAdd to .env.local:");
  console.log("ARC_BAND_ORACLE_ADAPTER_ADDRESS=" + adapter.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
