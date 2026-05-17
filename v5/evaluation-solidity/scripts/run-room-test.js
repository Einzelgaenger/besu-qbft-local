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
const DEFAULT_VOTE_MODE = "concurrent";
const FUND_AMOUNT = hre.ethers.parseEther(process.env.FUND_AMOUNT || "1");
const RECEIPT_WAIT_CONCURRENCY = Number(process.env.RECEIPT_WAIT_CONCURRENCY || 6);
const RECEIPT_POLL_MS = Number(process.env.RECEIPT_POLL_MS || 1000);
const RECEIPT_TIMEOUT_MS = Number(process.env.RECEIPT_TIMEOUT_MS || 120000);
const VOTE_RUN_TIMEOUT_MS = Number(process.env.VOTE_RUN_TIMEOUT_MS || 60000);
const ADMIN_TX_TIMEOUT_MS = Number(process.env.ADMIN_TX_TIMEOUT_MS || 120000);

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

function displayPath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
}

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function waitForReceiptWithRetry(txHash, stopAtMs = null) {
  const receiptDeadline = Date.now() + RECEIPT_TIMEOUT_MS;
  const deadline = stopAtMs ? Math.min(receiptDeadline, stopAtMs) : receiptDeadline;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(RECEIPT_POLL_MS);
  }

  const detail = lastError?.shortMessage || lastError?.message || "receipt not found";
  throw new Error(`Timed out waiting for receipt ${txHash}: ${detail}`);
}

async function waitForTransaction(tx, label, timeoutMs = ADMIN_TX_TIMEOUT_MS) {
  logStep(`${label} submitted: tx=${tx.hash}`);
  const receipt = await waitForReceiptWithRetry(tx.hash, Date.now() + timeoutMs);
  logStep(`${label} confirmed: block=${toNumber(receipt.blockNumber)}, gas=${receipt.gasUsed.toString()}`);
  return receipt;
}

function timeoutRow(row, message) {
  return {
    ...row,
    status: 0,
    ok: false,
    error: message,
    latencyMs: row.submittedAtMs ? Date.now() - row.submittedAtMs : null,
  };
}

async function deployRoomSystem(adminSigner) {
  logStep("Deploying VotingRoom implementation...");
  const VotingRoom = await hre.ethers.getContractFactory("VotingRoom", adminSigner);
  const implementation = await VotingRoom.deploy();
  await implementation.waitForDeployment();
  logStep(`VotingRoom implementation deployed: ${await implementation.getAddress()}`);

  logStep("Deploying RoomFactory...");
  const RoomFactory = await hre.ethers.getContractFactory("RoomFactory", adminSigner);
  const factory = await RoomFactory.deploy(await implementation.getAddress());
  await factory.waitForDeployment();
  logStep(`RoomFactory deployed: ${await factory.getAddress()}`);

  logStep("Deploying VotingResultCenter...");
  const VotingResultCenter = await hre.ethers.getContractFactory("VotingResultCenter", adminSigner);
  const resultCenter = await VotingResultCenter.deploy(await factory.getAddress());
  await resultCenter.waitForDeployment();
  logStep(`VotingResultCenter deployed: ${await resultCenter.getAddress()}`);

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
    logStep(`Using existing deployment file: ${displayPath(DEPLOYMENT_PATH)}`);
    return readJson(DEPLOYMENT_PATH);
  }

  logStep("Deployment file not found or REDEPLOY_SYSTEM=true. Deploying room system...");
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
  logStep(`Checking/funding ${accounts.length} EOA accounts...`);

  for (const [index, account] of accounts.entries()) {
    const balance = await hre.ethers.provider.getBalance(account.address);
    if (balance >= FUND_AMOUNT / 2n) {
      logStep(`EOA ${index + 1}/${accounts.length} already funded: ${account.address}`);
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
    const receipt = await waitForTransaction(tx, `Funding EOA ${index + 1}/${accounts.length}`);
    logStep(`Funded EOA ${index + 1}/${accounts.length}: ${account.address} in block ${toNumber(receipt.blockNumber)}`);
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
  logStep(`Creating room "${roomName}" from factory ${factoryAddress}...`);
  const factory = await hre.ethers.getContractAt("RoomFactory", factoryAddress, adminSigner);
  const tx = await factory.createRoom(roomName);
  const receipt = await waitForTransaction(tx, "createRoom()");
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
  logStep("Checking room status and admin...");
  const [roundId, roomState, readyToStart, startAt] = await room.getCurrentRoundStatus();
  let status = {
    roundId: toNumber(roundId),
    state: toNumber(roomState),
    readyToStart,
    startAt: toNumber(startAt),
  };
  const statusBeforePrepare = { ...status };
  const txRows = [];

  const adminAddress = await adminSigner.getAddress();
  const roomAdmin = await room.roomAdmin();
  if (roomAdmin.toLowerCase() !== adminAddress.toLowerCase()) {
    throw new Error(`EOA pertama harus admin room. Room admin: ${roomAdmin}, EOA pertama: ${adminAddress}`);
  }

  if (status.state !== 0) {
    throw new Error(`Room is active. Stop the current round first. Status: ${JSON.stringify(status)}`);
  }
  if (!status.readyToStart) {
    const reuseAction = (process.env.ROOM_REUSE_ACTION || "reset").toLowerCase();
    if (!["reset", "restart", "error"].includes(reuseAction)) {
      throw new Error("ROOM_REUSE_ACTION harus reset, restart, atau error");
    }
    if (reuseAction === "error") {
      throw new Error(`Room is inactive but not ready. Call restart() or reset() first. Status: ${JSON.stringify(status)}`);
    }

    logStep(`Room is inactive but not ready. Running ${reuseAction}()...`);
    const tx = reuseAction === "restart" ? await room.restart() : await room.reset();
    const receipt = await waitForTransaction(tx, `${reuseAction}()`);
    txRows.push({
      action: reuseAction,
      reason: "Room was inactive but roundReadyToStart was false.",
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
    });

    const [newRoundId, newRoomState, newReadyToStart, newStartAt] = await room.getCurrentRoundStatus();
    status = {
      roundId: toNumber(newRoundId),
      state: toNumber(newRoomState),
      readyToStart: newReadyToStart,
      startAt: toNumber(newStartAt),
    };
  }

  const currentVoters = await room.getVoters();
  if (currentVoters.length > 0) {
    logStep(`Removing ${currentVoters.length} existing voters...`);
    const tx = await room.removeAllVoters();
    const receipt = await waitForTransaction(tx, "removeAllVoters()");
    txRows.push({ action: "removeAllVoters", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  const [currentCandidateIds] = await room.getCandidates();
  if (currentCandidateIds.length > 0) {
    logStep(`Removing ${currentCandidateIds.length} existing candidates...`);
    const tx = await room.removeAllCandidates();
    const receipt = await waitForTransaction(tx, "removeAllCandidates()");
    txRows.push({ action: "removeAllCandidates", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  if (resultCenterAddress && (await room.resultCenter()).toLowerCase() !== resultCenterAddress.toLowerCase()) {
    logStep(`Setting result center: ${resultCenterAddress}`);
    const tx = await room.setResultCenter(resultCenterAddress);
    const receipt = await waitForTransaction(tx, "setResultCenter()");
    txRows.push({ action: "setResultCenter", txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
  }

  logStep(`Adding ${voters.length} voters...`);
  const addVotersTx = await room.addVoters(voters);
  const addVotersReceipt = await waitForTransaction(addVotersTx, "addVoters()");
  txRows.push({ action: "addVoters", txHash: addVotersReceipt.hash, gasUsed: addVotersReceipt.gasUsed.toString() });

  const candidateIds = candidateNames.map((_, index) => index + 1);
  logStep(`Adding ${candidateNames.length} candidates: ${candidateNames.join(", ")}`);
  const addCandidatesTx = await room.addCandidates(candidateIds, candidateNames);
  const addCandidatesReceipt = await waitForTransaction(addCandidatesTx, "addCandidates()");
  txRows.push({
    action: "addCandidates",
    txHash: addCandidatesReceipt.hash,
    gasUsed: addCandidatesReceipt.gasUsed.toString(),
    candidateIds,
    candidateNames,
  });

  return { statusBeforePrepare, statusAfterReuseAction: status, prepareTransactions: txRows, candidateIds };
}

async function runConcurrentVotes(roomAddress, voterSigners, candidateIds) {
  const startedAtMs = Date.now();
  const voteDeadlineMs = startedAtMs + VOTE_RUN_TIMEOUT_MS;
  logStep(`Sending ${voterSigners.length} vote transactions concurrently...`);
  logStep("Concurrent mode note: submit/confirm logs can appear out of order because voters run in parallel.");
  logStep(`Vote run timeout: ${VOTE_RUN_TIMEOUT_MS} ms.`);

  const submittedRows = await Promise.all(voterSigners.map(async (signer, index) => {
    const voter = await signer.getAddress();
    const candidateId = candidateIds[index % candidateIds.length];
    const voterRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
    const voteStartedAtMs = Date.now();

    try {
      const tx = await voterRoom.vote(candidateId, { gasPrice: 0 });
      logStep(`Vote ${index + 1}/${voterSigners.length} submitted: voter=${voter}, candidate=${candidateId}, tx=${tx.hash}`);
      return {
        index: index + 1,
        voter,
        candidateId,
        ok: null,
        txHash: tx.hash,
        submittedAtMs: voteStartedAtMs,
      };
    } catch (error) {
      logStep(`Vote ${index + 1}/${voterSigners.length} submit failed: voter=${voter}, candidate=${candidateId}`);
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
  }));

  const submittedSuccessRows = submittedRows.filter((row) => row.txHash);
  logStep(
    `Waiting for ${submittedSuccessRows.length} vote receipts with concurrency ${RECEIPT_WAIT_CONCURRENCY}...`
  );

  const confirmedRows = await mapWithConcurrency(
    submittedSuccessRows,
    RECEIPT_WAIT_CONCURRENCY,
    async (row) => {
      if (Date.now() >= voteDeadlineMs) {
        return timeoutRow(row, `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before receipt was checked.`);
      }

      try {
        const receipt = await waitForReceiptWithRetry(row.txHash, voteDeadlineMs);
        const status = toNumber(receipt.status);
        logStep(
          `Vote ${row.index}/${voterSigners.length} confirmed: voter=${row.voter}, candidate=${row.candidateId}, status=${status}, gas=${receipt.gasUsed.toString()}`
        );
        return {
          ...row,
          status,
          ok: status === 1,
          blockNumber: toNumber(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          latencyMs: Date.now() - row.submittedAtMs,
        };
      } catch (error) {
        logStep(`Vote ${row.index}/${voterSigners.length} receipt failed: tx=${row.txHash}`);
        return timeoutRow(row, error.shortMessage || error.message);
      }
    }
  );

  const confirmedByIndex = new Map(confirmedRows.map((row) => [row.index, row]));
  const rows = submittedRows.map((row) => confirmedByIndex.get(row.index) || row);
  const timeoutExceeded = Date.now() >= voteDeadlineMs || rows.some((row) => row.error?.includes("Vote run timeout"));
  return {
    mode: "concurrent",
    startedAtMs,
    finishedAtMs: Date.now(),
    elapsedMs: Date.now() - startedAtMs,
    timeoutMs: VOTE_RUN_TIMEOUT_MS,
    timeoutExceeded,
    rows,
  };
}

async function runSequentialVotes(roomAddress, voterSigners, candidateIds) {
  const startedAtMs = Date.now();
  const voteDeadlineMs = startedAtMs + VOTE_RUN_TIMEOUT_MS;
  const rows = [];
  logStep(`Sending ${voterSigners.length} vote transactions sequentially...`);
  logStep(`Vote run timeout: ${VOTE_RUN_TIMEOUT_MS} ms.`);

  for (const [index, signer] of voterSigners.entries()) {
    if (Date.now() >= voteDeadlineMs) {
      logStep(`Vote run timeout reached before vote ${index + 1}/${voterSigners.length}. Remaining votes will be skipped.`);
      for (let skippedIndex = index; skippedIndex < voterSigners.length; skippedIndex++) {
        const skippedVoter = await voterSigners[skippedIndex].getAddress();
        rows.push({
          index: skippedIndex + 1,
          voter: skippedVoter,
          candidateId: candidateIds[skippedIndex % candidateIds.length],
          status: 0,
          ok: false,
          skipped: true,
          error: `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before this vote was submitted.`,
          latencyMs: null,
        });
      }
      break;
    }

    const voter = await signer.getAddress();
    const candidateId = candidateIds[index % candidateIds.length];
    const voterRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
    const voteStartedAtMs = Date.now();

    try {
      logStep(`Vote ${index + 1}/${voterSigners.length} submitting: voter=${voter}, candidate=${candidateId}`);
      const tx = await voterRoom.vote(candidateId, { gasPrice: 0 });
      logStep(`Vote ${index + 1}/${voterSigners.length} submitted: tx=${tx.hash}`);
      const receipt = await waitForReceiptWithRetry(tx.hash, voteDeadlineMs);
      const status = toNumber(receipt.status);
      logStep(
        `Vote ${index + 1}/${voterSigners.length} confirmed: voter=${voter}, candidate=${candidateId}, status=${status}, gas=${receipt.gasUsed.toString()}`
      );
      rows.push({
        index: index + 1,
        voter,
        candidateId,
        ok: status === 1,
        txHash: tx.hash,
        submittedAtMs: voteStartedAtMs,
        status,
        blockNumber: toNumber(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: Date.now() - voteStartedAtMs,
      });
    } catch (error) {
      logStep(`Vote ${index + 1}/${voterSigners.length} failed: voter=${voter}, candidate=${candidateId}`);
      rows.push({
        index: index + 1,
        voter,
        candidateId,
        status: 0,
        ok: false,
        error: error.shortMessage || error.message,
        latencyMs: Date.now() - voteStartedAtMs,
      });

      if (Date.now() >= voteDeadlineMs) {
        logStep(`Vote run timeout reached after vote ${index + 1}/${voterSigners.length}. Remaining votes will be skipped.`);
        for (let skippedIndex = index + 1; skippedIndex < voterSigners.length; skippedIndex++) {
          const skippedVoter = await voterSigners[skippedIndex].getAddress();
          rows.push({
            index: skippedIndex + 1,
            voter: skippedVoter,
            candidateId: candidateIds[skippedIndex % candidateIds.length],
            status: 0,
            ok: false,
            skipped: true,
            error: `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before this vote was submitted.`,
            latencyMs: null,
          });
        }
        break;
      }
    }
  }

  const timeoutExceeded = Date.now() >= voteDeadlineMs || rows.some((row) => row.error?.includes("Vote run timeout"));
  return {
    mode: "sequential",
    startedAtMs,
    finishedAtMs: Date.now(),
    elapsedMs: Date.now() - startedAtMs,
    timeoutMs: VOTE_RUN_TIMEOUT_MS,
    timeoutExceeded,
    rows,
  };
}

async function runVotes(roomAddress, voterSigners, candidateIds, voteMode) {
  if (voteMode === "concurrent") {
    return runConcurrentVotes(roomAddress, voterSigners, candidateIds);
  }
  if (voteMode === "sequential") {
    return runSequentialVotes(roomAddress, voterSigners, candidateIds);
  }

  throw new Error("VOTE_MODE harus concurrent atau sequential");
}

async function refreshAvailableVoteReceipts(voteRun) {
  const rowsToRefresh = voteRun.rows.filter((row) => row.txHash && !row.ok);
  if (rowsToRefresh.length === 0) {
    return voteRun;
  }

  logStep(`Rechecking ${rowsToRefresh.length} timed-out/failed vote receipts before writing result...`);
  const refreshedRows = await mapWithConcurrency(rowsToRefresh, RECEIPT_WAIT_CONCURRENCY, async (row) => {
    try {
      const receipt = await hre.ethers.provider.getTransactionReceipt(row.txHash);
      if (!receipt) {
        return row;
      }

      const status = toNumber(receipt.status);
      return {
        ...row,
        status,
        ok: status === 1,
        blockNumber: toNumber(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        latencyMs: row.submittedAtMs ? Date.now() - row.submittedAtMs : row.latencyMs,
        refreshedAfterTimeout: true,
      };
    } catch {
      return row;
    }
  });

  const refreshedByIndex = new Map(refreshedRows.map((row) => [row.index, row]));
  return {
    ...voteRun,
    rows: voteRun.rows.map((row) => refreshedByIndex.get(row.index) || row),
  };
}

async function inspectRound(room, roundId, candidateIds, candidateNames) {
  logStep(`Inspecting round ${roundId} on-chain results...`);
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
  logStep("Starting v5 room evaluation test...");
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
  logStep(`Loaded ${accounts.length} EOA accounts. Admin EOA: ${adminAddress}`);

  const mode = (await askIfMissing(
    process.env.ROOM_MODE || process.argv[2],
    "Pilih mode room (new/existing): "
  )).toLowerCase();

  if (!["new", "existing"].includes(mode)) {
    throw new Error("ROOM_MODE harus new atau existing");
  }
  logStep(`Room mode: ${mode}`);

  const voteMode = (process.env.VOTE_MODE || DEFAULT_VOTE_MODE).toLowerCase();
  if (!["concurrent", "sequential"].includes(voteMode)) {
    throw new Error("VOTE_MODE harus concurrent atau sequential");
  }
  logStep(`Vote mode: ${voteMode}`);

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
    logStep(`New room created: ${roomInfo.address}`);
  } else {
    system = loadExistingRoomSystem();
    const roomAddress = await askIfMissing(process.env.ROOM_ADDRESS || process.argv[3], "Masukkan room address: ");
    roomInfo = { address: roomAddress };
    logStep(`Using existing room: ${roomInfo.address}`);
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

  logStep("Starting room round...");
  const startTx = await room.start();
  const startReceipt = await waitForTransaction(startTx, "start()");
  const roundId = toNumber((await room.getCurrentRoundStatus())[0]);
  logStep(`Round ${roundId} started in block ${toNumber(startReceipt.blockNumber)}`);

  let voteRun = await runVotes(roomInfo.address, voterSigners, prepare.candidateIds, voteMode);

  let stop = null;
  try {
    logStep("Stopping room round...");
    const stopTx = await room.stop();
    const stopReceipt = await waitForTransaction(stopTx, "stop()");
    stop = {
      ok: true,
      txHash: stopReceipt.hash,
      blockNumber: toNumber(stopReceipt.blockNumber),
      gasUsed: stopReceipt.gasUsed.toString(),
    };
    logStep(`Round ${roundId} stopped in block ${stop.blockNumber}`);
  } catch (error) {
    stop = {
      ok: false,
      error: error.shortMessage || error.message,
    };
    logStep(`Stopping room round failed: ${stop.error}`);
  }

  voteRun = await refreshAvailableVoteReceipts(voteRun);

  let inspect = null;
  try {
    inspect = await inspectRound(room, roundId, prepare.candidateIds, candidateNames);
  } catch (error) {
    inspect = {
      ok: false,
      error: error.shortMessage || error.message,
    };
    logStep(`Inspecting on-chain result failed: ${inspect.error}`);
  }

  let submitHistory = {
    skipped: true,
    reason: "No compatible local VotingResultCenter was found for this room.",
  };
  if (resultCenterAddress && stop?.ok) {
    try {
      logStep("Submitting round history to VotingResultCenter...");
      const submitTx = await room.submitRoundHistory(roundId);
      const submitReceipt = await waitForTransaction(submitTx, "submitRoundHistory()");
      submitHistory = {
        ok: true,
        txHash: submitReceipt.hash,
        blockNumber: toNumber(submitReceipt.blockNumber),
        gasUsed: submitReceipt.gasUsed.toString(),
      };
    } catch (error) {
      logStep("Submitting round history failed.");
      submitHistory = {
        ok: false,
        error: error.shortMessage || error.message,
      };
    }
  } else if (resultCenterAddress && !stop?.ok) {
    submitHistory = {
      skipped: true,
      reason: "Round history was not submitted because stop() did not complete successfully.",
    };
  }

  const successRows = voteRun.rows.filter((row) => row.ok);
  const latencyRows = successRows.map((row) => row.latencyMs);
  const gasRows = successRows.map((row) => BigInt(row.gasUsed));
  const totalVoteGasUsed = gasRows.reduce((sum, value) => sum + value, 0n);
  const avgVoteGasUsed = gasRows.length ? Number(totalVoteGasUsed) / gasRows.length : null;
  const result = {
    testName: `v5-room-30-eoa-${voteMode}-vote`,
    mode,
    voteMode,
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
    voteRun: {
      ...voteRun,
      successCount: successRows.length,
      failedCount: voteRun.rows.length - successRows.length,
      minLatencyMs: latencyRows.length ? Math.min(...latencyRows) : null,
      maxLatencyMs: latencyRows.length ? Math.max(...latencyRows) : null,
      avgLatencyMs: latencyRows.length
        ? latencyRows.reduce((sum, value) => sum + value, 0) / latencyRows.length
        : null,
      totalGasUsed: gasRows.length ? totalVoteGasUsed.toString() : null,
      avgGasUsed: avgVoteGasUsed,
      behavior:
        voteMode === "concurrent"
          ? "Semua vote dikirim bersamaan dari 30 EOA berbeda. Besu menerima transaksi paralel, lalu memasukkannya ke block secara deterministik. Karena nonce tiap EOA berbeda dan tiap EOA hanya vote sekali, ekspektasinya 30 transaksi sukses selama room Active."
          : "Vote dikirim satu per satu dari 30 EOA berbeda. Script menunggu receipt setiap vote sebelum mengirim vote berikutnya, sehingga log terminal dan urutan transaksi mudah dibaca.",
    },
    stop,
    inspect,
    submitHistory,
    measuredAt: new Date().toISOString(),
  };
  if (voteMode === "concurrent") {
    result.concurrentVoting = result.voteRun;
  } else {
    result.sequentialVoting = result.voteRun;
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const resultPath = path.join(RESULTS_DIR, `room-vote-${Date.now()}.json`);
  writeJson(resultPath, result);
  logStep(`Result saved to ${displayPath(resultPath)}`);

  console.log(JSON.stringify({
    resultPath: displayPath(resultPath),
    room: result.room,
    voteMode: result.voteMode,
    successCount: result.voteRun.successCount,
    failedCount: result.voteRun.failedCount,
    avgLatencyMs: result.voteRun.avgLatencyMs,
    avgGasUsed: result.voteRun.avgGasUsed,
    totalVoteGasUsed: result.voteRun.totalGasUsed,
    timeoutExceeded: result.voteRun.timeoutExceeded,
    totalVotes: result.inspect?.totalVotes ?? null,
    eventCount: result.inspect?.eventCount ?? null,
    candidates: result.inspect?.candidates ?? [],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
