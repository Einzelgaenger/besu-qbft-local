process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "besu";

const { runAction } = require("./room-cli");

runAction("stop").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
