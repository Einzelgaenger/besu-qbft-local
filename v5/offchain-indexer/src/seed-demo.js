const crypto = require("crypto");
const mongoose = require("mongoose");
const config = require("./config");
const { Room } = require("./models");

async function main() {
  await mongoose.connect(config.mongoUri);
  const now = Date.now();
  const samples = ["pending", "canceled", "confirmed"].map((status, i) => ({
    clientRequestId: crypto.randomUUID(),
    txHash: status === "confirmed" ? `0x${crypto.randomBytes(32).toString("hex")}` : undefined,
    adminAddress: `0x${crypto.randomBytes(20).toString("hex")}`,
    roomAddress: status === "confirmed" ? `0x${crypto.randomBytes(20).toString("hex")}` : undefined,
    roomName: `Demo Voting ${i + 1}`,
    chainId: config.chainId,
    status,
    failReason: status === "canceled" ? "wallet_rejected" : undefined,
    createdBlock: status === "confirmed" ? 1 : undefined,
    createdAt: new Date(now + i), updatedAt: new Date(now + i),
  }));
  const docs = await Room.insertMany(samples);
  console.log(JSON.stringify(docs, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
