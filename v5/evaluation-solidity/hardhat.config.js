require("@nomicfoundation/hardhat-ethers");
const { loadProjectEnv } = require("./scripts/load-env");

loadProjectEnv();

const DEPLOYER_PRIVATE_KEY =
  process.env.PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    besu: {
      url: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
      chainId: Number(process.env.CHAIN_ID || 1337),
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 0,
    },
  },
};
