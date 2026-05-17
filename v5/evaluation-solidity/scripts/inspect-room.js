const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const hre = require("hardhat");

const DEPLOYMENT_PATH = path.join(__dirname, "..", "deployments", "room-system.json");

async function askIfMissing(value, question) {
  if (value) return value;
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function toNumber(value) {
  return Number(value.toString());
}

async function main() {
  const roomAddress = await askIfMissing(process.env.ROOM_ADDRESS || process.argv[2], "Masukkan room address: ");
  const roundInput = await askIfMissing(process.env.ROUND_ID || process.argv[3], "Masukkan round id: ");
  const roundId = Number(roundInput);

  const room = await hre.ethers.getContractAt("VotingRoom", roomAddress);
  const [statusRound, roomState, readyToStart, startAt] = await room.getCurrentRoundStatus();
  const [candidateIds, candidateNames] = await room.getCandidates();
  const candidates = [];

  for (let i = 0; i < candidateIds.length; i++) {
    const votes = await room.getVotes(roundId, candidateIds[i]);
    candidates.push({
      id: toNumber(candidateIds[i]),
      name: candidateNames[i],
      votes: toNumber(votes),
    });
  }

  const voteEvents = await room.queryFilter(room.filters.VoteCast(roomAddress, roundId), 0, "latest");
  const result = {
    room: roomAddress,
    currentStatus: {
      roundId: toNumber(statusRound),
      state: toNumber(roomState),
      readyToStart,
      startAt: toNumber(startAt),
    },
    inspectedRound: roundId,
    totalVotes: toNumber(await room.roundTotalVotes(roundId)),
    eventCount: voteEvents.length,
    voterCount: toNumber(await room.getVoterCount()),
    candidates,
  };

  if (fs.existsSync(DEPLOYMENT_PATH)) {
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
    if (deployment.votingResultCenter) {
      const resultCenter = await hre.ethers.getContractAt("VotingResultCenter", deployment.votingResultCenter);
      result.latestPublishedVersion = toNumber(await resultCenter.getLatestVersion(roomAddress));
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
