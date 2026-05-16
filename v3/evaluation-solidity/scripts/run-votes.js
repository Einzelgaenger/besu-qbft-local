const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const deploymentPath = path.join(__dirname, "..", "deployments", "simple-voting.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const signer = (await hre.ethers.getSigners())[0];
  const voting = await hre.ethers.getContractAt("SimpleVoting", deployment.address, signer);

  const voteCount = Number(process.env.VOTE_COUNT || process.argv[2] || 30);
  const candidateCount = Number(await voting.candidateCount());
  const rows = [];

  console.log("index,candidateId,txHash,blockNumber,gasUsed,latencyMs,status");

  for (let i = 0; i < voteCount; i++) {
    const candidateId = i % candidateCount;
    const startedAt = Date.now();
    const tx = await voting.vote(candidateId);
    const receipt = await tx.wait();
    const latencyMs = Date.now() - startedAt;

    const row = {
      index: i + 1,
      candidateId,
      txHash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      latencyMs,
      status: Number(receipt.status),
    };

    rows.push(row);
    console.log(
      [
        row.index,
        row.candidateId,
        row.txHash,
        row.blockNumber,
        row.gasUsed,
        row.latencyMs,
        row.status,
      ].join(",")
    );
  }

  const latencies = rows.map((row) => row.latencyMs);
  const summary = {
    contractAddress: deployment.address,
    voteCount,
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    avgLatencyMs: latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    rows,
    measuredAt: new Date().toISOString(),
  };

  const outputDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `vote-run-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log("\nSummary");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nSaved to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
