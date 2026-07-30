const mongoose = require("mongoose");
const { JsonRpcProvider } = require("ethers");
const config = require("./config");

async function main() {
  await mongoose.connect(config.mongoUri);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const actual = Number(network.chainId);
  if (actual !== config.chainId) throw new Error(`Chain ID RPC ${actual}, tetapi CHAIN_ID=${config.chainId}`);
  await mongoose.connection.db.admin().ping();
  console.log(JSON.stringify({ mongodb: "connected", database: mongoose.connection.name, besu: "connected", chainId: actual }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
