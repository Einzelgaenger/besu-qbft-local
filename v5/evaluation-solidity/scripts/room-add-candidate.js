process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "besu";

const { runAction } = require("./room-cli");

runAction("add-candidate").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
