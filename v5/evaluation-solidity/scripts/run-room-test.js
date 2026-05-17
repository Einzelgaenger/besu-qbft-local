const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const hre = require("hardhat");

const ROOT = path.join(__dirname, "..");
const ACCOUNTS_PATH = path.join(ROOT, "accounts", "eoa-30.json");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "room-system.json");
const RESULTS_DIR = path.join(ROOT, "results");

const DEFAULT_CANDIDATES = ["Candidate A", "Candidate B", "Candidate C"];
const DEFAULT_ROOM_NAME = "V5 Evaluation Room";
const FUND_AMOUNT = hre.ethers.parseEther(process.env.FUND_AMOUNT || "1");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

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

async function deployRoomSystem(adminSigner) {
  const VotingRoom = await hre.ethers.getContractFactory("VotingRoom", adminSigner);
  const implementation = await VotingRoom.deploy();
  await implementation.waitForDeployment();

  const RoomFactory = await hre.ethers.getContractFactory("RoomFactory", adminSigner);
  const factory = await RoomFactory.deploy(await implementation.getAddress());
  await factory.waitForDeployment();

  const VotingResultCenter = await hre.ethers.getContractFactory("VotingResultCenter", adminSigner);
  const resultCenter = await VotingResultCenter.deploy(await factory.getAddress());
  await resultCenter.waitForDeployment();

  const deployment = {
    votingRoomImplementation: await implementation.getAddress(),
    roomFactory: await factory.getAddress(),
    votingResultCenter: await resultCenter.getAddress(),
    admin: await adminSigner.getAddress(),
    network: hre.network.name,
    rpcUrl: hre.network.config.url,
    chainId: hre.network.config.chainId,
    deployedAt: new Date().toISOString(),
  };

  writeJson(DEPLOYMENT_PATH, deployment);
  return deployment;
}

async function loadOrDeployRoomSystem(adminSigner) {
  if (fs.existsSync(DEPLOYMENT_PATH) && process.env.REDEPLOY_SYSTEM !== "true") {
    return readJson(DEPLOYMENT_PATH);
  }

  return deployRoomSystem(adminSigner);
}

function loadExistingRoomSystem() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    return null;
  }

  return readJson(DEPLOYMENT_PATH);
}

async function fundAccounts(deployer, accounts) {
  const rows = [];

  for (const account of accounts) {
    const balance = await hre.ethers.provider.getBalance(account.address);
    if (balance >= FUND_AMOUNT / 2n) {
      rows.push({
        address: account.address,
        funded: false,
        balanceWei: balance.toString(),
      });
      continue;
    }

    const tx = await deployer.sendTransaction({
      to: account.address,
      value: FUND_AMOUNT,
      gasPrice: 0,
    });
    const receipt = await tx.wait();
    rows.push({
      address: account.address,
      funded: true,
      txHash: receipt.hash,
      blockNumber: toNumber(receipt.blockNumber),
      balanceWei: (await hre.ethers.provider.getBalance(account.address)).toString(),
    });
  }

  return rows;
}

async function createRoom(factoryAddress, adminSigner, roomName) {
  const factory = await hre.ethers.getContractAt("RoomFactory", factoryAddress, adminSigner);
  const tx = await factory.createRoom(roomName);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "RoomRegistered");

  if (!event) {
    throw new Error("RoomRegistered event not found after createRoom");
  }

  return {
    address: event.args.room,
    txHash: receipt.hash,
    blockNumber: toNumber(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  };
}

async function prepareReadyRoom(room, adminSigner, resultCenterAddress, voters, candidateNames) {
  const [roundId, roomState, readyToStart, startAt] = await room.getCurrentRoundStatus();
  const status = {
    roundId: toNumber(roundId),
    state: toNumber(roomState),
    readyToStart,
    startAt: toNumber(startAt),
  };

  if (status.state !== 0) {
    throw new Error(`Room is active. Stop the current round first. Status: ${JSON.stringify(status)}`);
  }
  if (!status.readyToStart) {
    throw new Error(`Room is inactive but not ready. Call restart() or reset() first. Status: ${JSON.stringify(status)}`);
  }

  const adminAddress = await adminSigner.getAddress();
  const roomAdmin = await room.roomAdmin();
  if (roomAdmin.toLowerCase() !== adminAddress.toLowerCase()) {
    throw new Error(`EOA pertama harus admin room. Room admin: ${roomAdmin}, EOA pertama: ${adminAddress}`);
  }

  const txRows = [];
  const currentVoters = await room.getVoters();
  if (currentVoters.length > 0) {
    const tx = await room.removeAllVoters();
    const receipt = await tx.wait();
    txRows.push({ action: "removeAllVoters", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  const [currentCandidateIds] = await room.getCandidates();
  if (currentCandidateIds.length > 0) {
    const tx = await room.removeAllCandidates();
    const receipt = await tx.wait();
    txRows.push({ action: "removeAllCandidates", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  if (resultCenterAddress && (await room.resultCenter()).toLowerCase() !== resultCenterAddress.toLowerCase()) {
    const tx = await room.setResultCenter(resultCenterAddress);
    const receipt = await tx.wait();
    txRows.push({ action: "setResultCenter", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  const addVotersTx = await room.addVoters(voters);
  const addVotersReceipt = await addVotersTx.wait();
  txRows.push({ action: "addVoters", txHash: addVotersReceipt.hash, gasUsed: addVotersReceipt.gasUsed.toString() });

  const candidateIds = candidateNames.map((_, index) => index + 1);
  const addCandidatesTx = await room.addCandidates(candidateIds, candidateNames);
  const addCandidatesReceipt = await addCandidatesTx.wait();
  txRows.push({
    action: "addCandidates",
    txHash: addCandidatesReceipt.hash,
    gasUsed: addCandidatesReceipt.gasUsed.toString(),
    candidateIds,
    candidateNames,
  });

  return { statusBeforePrepare: status, prepareTransactions: txRows, candidateIds };
}

async function runConcurrentVotes(roomAddress, voterSigners, candidateIds) {
  const startedAtMs = Date.now();

  const votePromises = voterSigners.map(async (signer, index) => {
    const voter = await signer.getAddress();
    const candidateId = candidateIds[index % candidateIds.length];
    const voterRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
    const voteStartedAtMs = Date.now();

    try {
      const tx = await voterRoom.vote(candidateId, { gasPrice: 0 });
      const receipt = await tx.wait();
      return {
        index: index + 1,
        voter,
        candidateId,
        status: toNumber(receipt.status),
        ok: receipt.status === 1n,
        txHash: receipt.hash,
        blockNumber: toNumber(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: Date.now() - voteStartedAtMs,
      };
    } catch (error) {
      return {
        index: index + 1,
        voter,
        candidateId,
        status: 0,
        ok: false,
        error: error.shortMessage || error.message,
        latencyMs: Date.now() - voteStartedAtMs,
      };
    }
  });

  const rows = await Promise.all(votePromises);
  return {
    mode: "concurrent",
    startedAtMs,
    finishedAtMs: Date.now(),
    elapsedMs: Date.now() - startedAtMs,
    rows,
  };
}

async function inspectRound(room, roundId, candidateIds, candidateNames) {
  const totalVotes = await room.roundTotalVotes(roundId);
  const onChainCandidates = [];

  for (let i = 0; i < candidateIds.length; i++) {
    const votes = await room.getVotes(roundId, candidateIds[i]);
    onChainCandidates.push({
      id: candidateIds[i],
      name: candidateNames[i],
      votes: toNumber(votes),
    });
  }

  const events = await room.queryFilter(room.filters.VoteCast(room.target, roundId), 0, "latest");

  return {
    roundId,
    totalVotes: toNumber(totalVotes),
    eventCount: events.length,
    candidates: onChainCandidates,
  };
}

async function resultCenterForRoom(system, roomAddress) {
  if (!system?.roomFactory || !system?.votingResultCenter) {
    return null;
  }

  try {
    const factory = await hre.ethers.getContractAt("RoomFactory", system.roomFactory);
    const isKnownRoom = await factory.isRoom(roomAddress);
    return isKnownRoom ? system.votingResultCenter : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    throw new Error("EOA file not found. Run: npm run generate:eoa");
  }

  const accountPayload = readJson(ACCOUNTS_PATH);
  if (accountPayload.accounts.length < 30) {
    throw new Error(`Need at least 30 EOA accounts, found ${accountPayload.accounts.length}`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const accounts = accountPayload.accounts.slice(0, 30);
  const voterSigners = accounts.map((account) => new hre.ethers.Wallet(account.privateKey, hre.ethers.provider));
  const adminSigner = voterSigners[0];
  const adminAddress = await adminSigner.getAddress();

  const mode = (await askIfMissing(
    process.env.ROOM_MODE || process.argv[2],
    "Pilih mode room (new/existing): "
  )).toLowerCase();

  if (!["new", "existing"].includes(mode)) {
    throw new Error("ROOM_MODE harus new atau existing");
  }

  const candidateNames = (process.env.CANDIDATES || DEFAULT_CANDIDATES.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (candidateNames.length !== 3) {
    throw new Error("Testing ini mengharapkan tepat 3 candidate. Set CANDIDATES dengan 3 nama dipisah koma.");
  }

  const fundRows = await fundAccounts(deployer, accounts);
  let system = null;
  let roomInfo;

  if (mode === "new") {
    system = await loadOrDeployRoomSystem(adminSigner);
    roomInfo = await createRoom(
      system.roomFactory,
      adminSigner,
      process.env.ROOM_NAME || DEFAULT_ROOM_NAME
    );
  } else {
    system = loadExistingRoomSystem();
    const roomAddress = await askIfMissing(process.env.ROOM_ADDRESS || process.argv[3], "Masukkan room address: ");
    roomInfo = { address: roomAddress };
  }

  const room = await hre.ethers.getContractAt("VotingRoom", roomInfo.address, adminSigner);
  const resultCenterAddress = await resultCenterForRoom(system, roomInfo.address);
  const prepare = await prepareReadyRoom(
    room,
    adminSigner,
    resultCenterAddress,
    accounts.map((account) => account.address),
    candidateNames
  );

  const startTx = await room.start();
  const startReceipt = await startTx.wait();
  const roundId = toNumber((await room.getCurrentRoundStatus())[0]);

  const voteRun = await runConcurrentVotes(roomInfo.address, voterSigners, prepare.candidateIds);

  const stopTx = await room.stop();
  const stopReceipt = await stopTx.wait();
  const inspect = await inspectRound(room, roundId, prepare.candidateIds, candidateNames);

  let submitHistory = {
    skipped: true,
    reason: "No compatible local VotingResultCenter was found for this room.",
  };
  if (resultCenterAddress) {
    try {
      const submitTx = await room.submitRoundHistory(roundId);
      const submitReceipt = await submitTx.wait();
      submitHistory = {
        ok: true,
        txHash: submitReceipt.hash,
        blockNumber: toNumber(submitReceipt.blockNumber),
        gasUsed: submitReceipt.gasUsed.toString(),
      };
    } catch (error) {
      submitHistory = {
        ok: false,
        error: error.shortMessage || error.message,
      };
    }
  }

  const successRows = voteRun.rows.filter((row) => row.ok);
  const latencyRows = successRows.map((row) => row.latencyMs);
  const result = {
    testName: "v5-room-30-eoa-concurrent-vote",
    mode,
    room: roomInfo.address,
    admin: adminAddress,
    system,
    resultCenterUsed: resultCenterAddress,
    candidates: candidateNames.map((name, index) => ({ id: prepare.candidateIds[index], name })),
    voterCount: accounts.length,
    fundedAccounts: fundRows,
    prepare,
    start: {
      txHash: startReceipt.hash,
      blockNumber: toNumber(startReceipt.blockNumber),
      gasUsed: startReceipt.gasUsed.toString(),
    },
    concurrentVoting: {
      ...voteRun,
      successCount: successRows.length,
      failedCount: voteRun.rows.length - successRows.length,
      minLatencyMs: latencyRows.length ? Math.min(...latencyRows) : null,
      maxLatencyMs: latencyRows.length ? Math.max(...latencyRows) : null,
      avgLatencyMs: latencyRows.length
        ? latencyRows.reduce((sum, value) => sum + value, 0) / latencyRows.length
        : null,
      behavior:
        "Semua vote dikirim bersamaan dari 30 EOA berbeda. Besu menerima transaksi paralel, lalu memasukkannya ke block secara deterministik. Karena nonce tiap EOA berbeda dan tiap EOA hanya vote sekali, ekspektasinya 30 transaksi sukses selama room Active.",
    },
    stop: {
      txHash: stopReceipt.hash,
      blockNumber: toNumber(stopReceipt.blockNumber),
      gasUsed: stopReceipt.gasUsed.toString(),
    },
    inspect,
    submitHistory,
    measuredAt: new Date().toISOString(),
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultPath = path.join(RESULTS_DIR, `room-vote-${Date.now()}.json`);
  writeJson(resultPath, result);

  console.log(JSON.stringify({
    resultPath,
    room: result.room,
    successCount: result.concurrentVoting.successCount,
    failedCount: result.concurrentVoting.failedCount,
    totalVotes: result.inspect.totalVotes,
    candidates: result.inspect.candidates,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
