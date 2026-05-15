import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { defineConfig } from "hardhat/config";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config({ path: "../.env.local", override: false });

const PRIVATE_KEY =
  process.env.PRIVATE_KEY ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, hardhatVerify],

  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    arcTestnet: {
      type: "http",
      url: process.env.ARC_TESTNET_RPC || "https://rpc.testnet.arc.network",
      accounts: [PRIVATE_KEY],
      chainId: 5042002,
    },

    baseSepoliaTestnet: {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: [PRIVATE_KEY],
      chainId: 84532,
    },

    arbitrumSepoliaTestnet: {
      type: "http",
      url: process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: [PRIVATE_KEY],
      chainId: 421614,
    },

    ethereumSepoliaTestnet: {
      type: "http",
      url: process.env.ETHEREUM_SEPOLIA_RPC || "https://ethereum-sepolia.publicnode.com",
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
    },

    opSepoliaTestnet: {
      type: "http",
      url: process.env.OP_SEPOLIA_RPC || "https://sepolia.optimism.io",
      accounts: [PRIVATE_KEY],
      chainId: 11155420,
    },
  },

  etherscan: {
    apiKey: {
      arcTestnet: process.env.ARCSCAN_API_KEY || "",
      baseSepoliaTestnet: process.env.BASESCAN_API_KEY || "",
      arbitrumSepoliaTestnet: process.env.ARBISCAN_API_KEY || "",
      ethereumSepoliaTestnet: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
      {
        network: "opSepoliaTestnet",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io",
        },
      },
    ],
  },

  paths: {
    sources: "./arc",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 40000,
  },
});
