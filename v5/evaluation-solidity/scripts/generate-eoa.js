const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const ACCOUNT_COUNT = Number(process.env.ACCOUNT_COUNT || 30);
const outputDir = path.join(__dirname, "..", "accounts");
const outputPath = path.join(outputDir, "eoa-collections.json");

fs.mkdirSync(outputDir, { recursive: true });

const accounts = Array.from({ length: ACCOUNT_COUNT }, (_, index) => {
  const wallet = Wallet.createRandom();
  return {
    index: index + 1,
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase,
  };
});

const payload = {
  count: accounts.length,
  admin: accounts[0].address,
  generatedAt: new Date().toISOString(),
  accounts,
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

console.log(JSON.stringify({
  count: payload.count,
  admin: payload.admin,
  outputPath,
}, null, 2));
