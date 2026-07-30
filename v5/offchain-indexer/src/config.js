const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), override: true });

module.exports = {
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/besu_voting",
  rpcUrl: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID || 1337),
  factoryAddress: process.env.ROOM_FACTORY_ADDRESS || "",
  startBlock: Number(process.env.START_BLOCK || 0),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 4000),
};
