const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "simple-voting.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const voting = await hre.ethers.getContractAt("SimpleVoting", deployment.address);

  const [names, votes] = await voting.getResults();
  const totalVotes = await voting.totalVotes();
  const events = await voting.queryFilter(voting.filters.VoteCast(), 0, "latest");

  const candidates = names.map((name, index) => ({
    id: index,
    name,
    votes: votes[index].toString(),
  }));

  const result = {
    contractAddress: deployment.address,
    totalVotes: totalVotes.toString(),
    eventCount: events.length,
    candidates,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
