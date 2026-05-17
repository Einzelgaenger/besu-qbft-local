process.env.HARDHAT_NETWORK = process.env.HARDHAT_NETWORK || "besu";

const { runAction } = require("./room-cli");

runAction("start").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
