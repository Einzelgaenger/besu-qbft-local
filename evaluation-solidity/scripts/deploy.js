const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const candidates = process.env.CANDIDATES
    ? process.env.CANDIDATES.split(",").map((name) => name.trim()).filter(Boolean)
    : ["Candidate A", "Candidate B", "Candidate C"];

  const SimpleVoting = await hre.ethers.getContractFactory("SimpleVoting");
  const voting = await SimpleVoting.deploy(candidates);
  await voting.waitForDeployment();

  const deployTx = voting.deploymentTransaction();
  const receipt = await deployTx.wait();
  const address = await voting.getAddress();

  const deployment = {
    contract: "SimpleVoting",
    address,
    candidates,
    transactionHash: receipt.hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    network: hre.network.name,
    rpcUrl: hre.network.config.url,
    chainId: hre.network.config.chainId,
    deployedAt: new Date().toISOString(),
  };

  const outputDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "simple-voting.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
