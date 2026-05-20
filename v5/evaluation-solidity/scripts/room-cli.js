const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const hre = require("hardhat");

const ROOT = path.join(__dirname, "..");
const ACCOUNTS_PATH = path.join(ROOT, "accounts", "eoa-collections.json");
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "room-system.json");
const RESULTS_DIR = path.join(ROOT, "results");
const DEFAULT_CANDIDATES = ["Candidate A", "Candidate B", "Candidate C"];
const DEFAULT_VOTE_MODE = "concurrent";
const RECEIPT_WAIT_CONCURRENCY = Number(process.env.RECEIPT_WAIT_CONCURRENCY || 6);
const RECEIPT_POLL_MS = Number(process.env.RECEIPT_POLL_MS || 1000);
const ADMIN_TX_TIMEOUT_MS = Number(process.env.ADMIN_TX_TIMEOUT_MS || 120000);
const ADMIN_GAS_LIMIT = process.env.ADMIN_GAS_LIMIT ? BigInt(process.env.ADMIN_GAS_LIMIT) : null;
const ADMIN_GAS_BUFFER_PERCENT = BigInt(process.env.ADMIN_GAS_BUFFER_PERCENT || 130);
const VOTE_RUN_TIMEOUT_MS = Number(process.env.VOTE_RUN_TIMEOUT_MS || 60000);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`Deployment file not found: ${DEPLOYMENT_PATH}`);
  }
  return readJson(DEPLOYMENT_PATH);
}

function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    return [];
  }
  return readJson(ACCOUNTS_PATH).accounts || [];
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      parsed[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[withoutPrefix] = next;
      i += 1;
    } else {
      parsed[withoutPrefix] = true;
    }
  }

  return parsed;
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

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sanitizePathSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function timestampForFolder(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
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

function normalizeAddressList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNumberList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function loadRequiredAccounts() {
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    throw new Error("EOA file not found or empty. Run: npm run generate:eoa");
  }
  return accounts;
}

function getDefaultVoters() {
  return loadRequiredAccounts().map((account) => account.address);
}

function getDefaultVoterSigners() {
  return loadRequiredAccounts().map((account) => signerFromPrivateKey(account.privateKey));
}

function getCandidateNames(args) {
  const namesInput = process.env.CANDIDATES || args.candidates;
  if (!namesInput) return DEFAULT_CANDIDATES;
  const names = namesInput.split(",").map((item) => item.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error("CANDIDATES is empty");
  }
  return names;
}

function getCandidateIds(args, fallbackCount = DEFAULT_CANDIDATES.length) {
  const explicitIds = normalizeNumberList(process.env.CANDIDATE_IDS || args.ids || args["candidate-ids"]);
  if (explicitIds.length > 0) return explicitIds;
  return Array.from({ length: fallbackCount }, (_, index) => index + 1);
}

async function waitForReceipt(txHash, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
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

async function waitForReceiptUntil(txHash, deadlineMs) {
  let lastError = null;

  while (Date.now() < deadlineMs) {
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

async function waitForTransaction(tx, label, timeoutMs) {
  logStep(`${label} submitted: tx=${tx.hash}`);
  const receipt = await waitForReceipt(tx.hash, timeoutMs);
  logStep(`${label} confirmed: block=${toNumber(receipt.blockNumber)}, status=${toNumber(receipt.status)}, gas=${receipt.gasUsed.toString()}`);
  if (toNumber(receipt.status) !== 1) {
    throw new Error(`${label} reverted on-chain. tx=${tx.hash}, block=${toNumber(receipt.blockNumber)}, gasUsed=${receipt.gasUsed.toString()}`);
  }
  return receipt;
}

async function adminTxOverrides(estimateGas) {
  if (ADMIN_GAS_LIMIT) {
    return { gasPrice: 0, gasLimit: ADMIN_GAS_LIMIT };
  }

  try {
    const estimatedGas = await estimateGas();
    const bufferedGas = (estimatedGas * ADMIN_GAS_BUFFER_PERCENT) / 100n + 50000n;
    return { gasPrice: 0, gasLimit: bufferedGas };
  } catch {
    return { gasPrice: 0 };
  }
}

function signerFromPrivateKey(privateKey) {
  return new hre.ethers.Wallet(privateKey, hre.ethers.provider);
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

async function getAdminSigner(deployment) {
  const privateKey = process.env.ADMIN_PRIVATE_KEY || process.env.ROOM_ADMIN_PRIVATE_KEY;
  if (privateKey) {
    return signerFromPrivateKey(privateKey);
  }

  const expectedAdmin = deployment.admin?.toLowerCase();
  const account = loadAccounts().find((item) => item.address?.toLowerCase() === expectedAdmin);
  if (account?.privateKey) {
    return signerFromPrivateKey(account.privateKey);
  }

  const [defaultSigner] = await hre.ethers.getSigners();
  const defaultAddress = await defaultSigner.getAddress();
  if (!expectedAdmin || defaultAddress.toLowerCase() === expectedAdmin) {
    return defaultSigner;
  }

  throw new Error(
    `Admin private key not found. Deployment admin is ${deployment.admin}. Set ADMIN_PRIVATE_KEY or add the admin to accounts/eoa-collections.json.`
  );
}

async function getRoom(args) {
  return askIfMissing(process.env.ROOM_ADDRESS || args.room || args._[0], "Masukkan room address: ");
}

async function getAdminRoom(args) {
  const deployment = loadDeployment();
  const roomAddress = await getRoom(args);
  const signer = await getAdminSigner(deployment);
  const room = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
  const signerAddress = await signer.getAddress();
  let roomAdmin;

  try {
    roomAdmin = await room.roomAdmin();
  } catch (error) {
    const detail = error?.shortMessage || error?.message || String(error);
    throw new Error(`Cannot read roomAdmin() from ${roomAddress}. Make sure ROOM_ADDRESS is a VotingRoom on network ${hre.network.name}. Detail: ${detail}`);
  }

  if (roomAdmin.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(`Signer is not room admin. Room admin: ${roomAdmin}, signer: ${signerAddress}`);
  }

  return { deployment, roomAddress, signer, room };
}

async function resetRoom(args) {
  const { roomAddress, room } = await getAdminRoom(args);
  const tx = await room.reset(await adminTxOverrides(() => room.reset.estimateGas({ gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, "reset()", ADMIN_TX_TIMEOUT_MS);
  const [roundId, state, readyToStart, startAt] = await room.getCurrentRoundStatus();

  console.log(JSON.stringify({
    action: "reset",
    room: roomAddress,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    currentStatus: {
      roundId: toNumber(roundId),
      state: toNumber(state),
      readyToStart,
      startAt: toNumber(startAt),
    },
  }, null, 2));
}

async function addVoter(args) {
  const { roomAddress, room } = await getAdminRoom(args);
  let voters = normalizeAddressList(process.env.VOTERS || args.voters);
  const singleVoter = process.env.VOTER_ADDRESS || args.voter || args._[1];
  if (singleVoter) {
    voters = [singleVoter];
  }
  if (voters.length === 0) {
    voters = getDefaultVoters();
  }

  const tx = voters.length === 1
    ? await room.addVoter(voters[0], await adminTxOverrides(() => room.addVoter.estimateGas(voters[0], { gasPrice: 0 })))
    : await room.addVoters(voters, await adminTxOverrides(() => room.addVoters.estimateGas(voters, { gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, voters.length === 1 ? "addVoter()" : "addVoters()", ADMIN_TX_TIMEOUT_MS);

  console.log(JSON.stringify({
    action: voters.length === 1 ? "addVoter" : "addVoters",
    room: roomAddress,
    voters,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    voterCount: toNumber(await room.getVoterCount()),
    source: voters.length === 30 ? "accounts/eoa-collections.json" : "input",
  }, null, 2));
}

async function addCandidate(args) {
  const { roomAddress, room } = await getAdminRoom(args);
  const explicitId = process.env.CANDIDATE_ID || args.id || args["candidate-id"] || args._[1];
  const explicitName = process.env.CANDIDATE_NAME || args.name || args["candidate-name"] || args._[2];
  let ids;
  let names;
  let label;

  if (explicitId || explicitName) {
    const candidateIdInput = await askIfMissing(explicitId, "Masukkan candidate id: ");
    const candidateName = await askIfMissing(explicitName, "Masukkan candidate name: ");
    const candidateId = Number(candidateIdInput);

    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      throw new Error(`Invalid candidate id: ${candidateIdInput}`);
    }

    ids = [candidateId];
    names = [candidateName];
    label = "addCandidate()";
  } else {
    names = getCandidateNames(args);
    ids = getCandidateIds(args, names.length);
    if (ids.length !== names.length) {
      throw new Error(`Candidate id count (${ids.length}) must match candidate name count (${names.length})`);
    }
    label = "addCandidates()";
  }

  const tx = ids.length === 1
    ? await room.addCandidate(ids[0], names[0], await adminTxOverrides(() => room.addCandidate.estimateGas(ids[0], names[0], { gasPrice: 0 })))
    : await room.addCandidates(ids, names, await adminTxOverrides(() => room.addCandidates.estimateGas(ids, names, { gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, label, ADMIN_TX_TIMEOUT_MS);
  const [candidateIds, candidateNames] = await room.getCandidates();

  console.log(JSON.stringify({
    action: ids.length === 1 ? "addCandidate" : "addCandidates",
    room: roomAddress,
    addedCandidates: ids.map((id, index) => ({ id, name: names[index] })),
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    candidateCount: candidateIds.length,
    candidates: candidateIds.map((id, index) => ({
      id: toNumber(id),
      name: candidateNames[index],
    })),
  }, null, 2));
}

async function startRoom(args) {
  const { roomAddress, room } = await getAdminRoom(args);
  const [beforeRoundId, beforeState, beforeReadyToStart, beforeStartAt] = await room.getCurrentRoundStatus();
  const statusBeforeStart = {
    roundId: toNumber(beforeRoundId),
    state: toNumber(beforeState),
    readyToStart: beforeReadyToStart,
    startAt: toNumber(beforeStartAt),
  };

  if (statusBeforeStart.state === 1) {
    console.log(JSON.stringify({
      action: "start",
      room: roomAddress,
      skipped: true,
      reason: "Room is already Active.",
      currentStatus: statusBeforeStart,
    }, null, 2));
    return;
  }

  const txRows = [];
  let statusBeforeActualStart = statusBeforeStart;

  if (!statusBeforeActualStart.readyToStart) {
    const reuseAction = (process.env.ROOM_START_REUSE_ACTION || process.env.ROOM_REUSE_ACTION || "restart").toLowerCase();
    if (!["restart", "reset", "error"].includes(reuseAction)) {
      throw new Error("ROOM_START_REUSE_ACTION/ROOM_REUSE_ACTION harus restart, reset, atau error");
    }
    if (reuseAction === "error") {
      throw new Error(`Room belum ready untuk start(). Jalankan restart() atau reset() dulu. Status: ${JSON.stringify(statusBeforeActualStart)}`);
    }

    logStep(`Room is inactive but not ready. Running ${reuseAction}() before start()...`);
    const reuseTx = reuseAction === "restart"
      ? await room.restart(await adminTxOverrides(() => room.restart.estimateGas({ gasPrice: 0 })))
      : await room.reset(await adminTxOverrides(() => room.reset.estimateGas({ gasPrice: 0 })));
    const reuseReceipt = await waitForTransaction(reuseTx, `${reuseAction}()`, ADMIN_TX_TIMEOUT_MS);
    txRows.push({
      action: reuseAction,
      reason: "Room was inactive but roundReadyToStart was false.",
      txHash: reuseReceipt.hash,
      gasUsed: reuseReceipt.gasUsed.toString(),
      blockNumber: toNumber(reuseReceipt.blockNumber),
    });

    const [roundId, state, readyToStart, startAt] = await room.getCurrentRoundStatus();
    statusBeforeActualStart = {
      roundId: toNumber(roundId),
      state: toNumber(state),
      readyToStart,
      startAt: toNumber(startAt),
    };
  }

  const voterCount = toNumber(await room.getVoterCount());
  const [candidateIds] = await room.getCandidates();
  if (voterCount === 0 || candidateIds.length === 0) {
    throw new Error(
      `Room belum bisa start(): voterCount=${voterCount}, candidateCount=${candidateIds.length}. Jalankan room:add-voter dan room:add-candidate dulu.`
    );
  }

  const tx = await room.start(await adminTxOverrides(() => room.start.estimateGas({ gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, "start()", ADMIN_TX_TIMEOUT_MS);
  const [roundId, state, readyToStart, startAt] = await room.getCurrentRoundStatus();

  console.log(JSON.stringify({
    action: "start",
    room: roomAddress,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    blockNumber: toNumber(receipt.blockNumber),
    prepareTransactions: txRows,
    statusBeforeStart,
    statusBeforeActualStart,
    currentStatus: {
      roundId: toNumber(roundId),
      state: toNumber(state),
      readyToStart,
      startAt: toNumber(startAt),
    },
  }, null, 2));
}

async function stopRoom(args) {
  const { roomAddress, room } = await getAdminRoom(args);
  const [beforeRoundId, beforeState, beforeReadyToStart, beforeStartAt] = await room.getCurrentRoundStatus();

  if (toNumber(beforeState) !== 1) {
    console.log(JSON.stringify({
      action: "stop",
      room: roomAddress,
      skipped: true,
      reason: "Room is not Active.",
      currentStatus: {
        roundId: toNumber(beforeRoundId),
        state: toNumber(beforeState),
        readyToStart: beforeReadyToStart,
        startAt: toNumber(beforeStartAt),
      },
    }, null, 2));
    return;
  }

  const tx = await room.stop(await adminTxOverrides(() => room.stop.estimateGas({ gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, "stop()", ADMIN_TX_TIMEOUT_MS);
  const [roundId, state, readyToStart, startAt] = await room.getCurrentRoundStatus();

  console.log(JSON.stringify({
    action: "stop",
    room: roomAddress,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    blockNumber: toNumber(receipt.blockNumber),
    statusBeforeStop: {
      roundId: toNumber(beforeRoundId),
      state: toNumber(beforeState),
      readyToStart: beforeReadyToStart,
      startAt: toNumber(beforeStartAt),
    },
    currentStatus: {
      roundId: toNumber(roundId),
      state: toNumber(state),
      readyToStart,
      startAt: toNumber(startAt),
    },
  }, null, 2));
}

function summarizeVoteRun(voteRun) {
  const successRows = voteRun.rows.filter((row) => row.ok);
  const totalGasUsed = successRows.reduce((sum, row) => sum + BigInt(row.gasUsed || 0), 0n);
  const latencies = successRows.map((row) => row.latencyMs).filter((value) => typeof value === "number");
  const avgLatencyMs = latencies.length > 0
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;
  const avgGasUsed = successRows.length > 0 ? (totalGasUsed / BigInt(successRows.length)).toString() : "0";

  return {
    successCount: successRows.length,
    failedCount: voteRun.rows.length - successRows.length,
    totalGasUsed: totalGasUsed.toString(),
    avgGasUsed,
    avgLatencyMs,
  };
}

async function runConcurrentVotes(roomAddress, voterSigners, candidateIds) {
  const startedAtMs = Date.now();
  const voteDeadlineMs = startedAtMs + VOTE_RUN_TIMEOUT_MS;
  logStep(`Sending ${voterSigners.length} vote transactions concurrently...`);
  logStep(`Vote mode: concurrent. Vote run timeout: ${VOTE_RUN_TIMEOUT_MS} ms.`);

  const submittedRows = await Promise.all(voterSigners.map(async (signer, index) => {
    const voter = await signer.getAddress();
    const candidateId = candidateIds[index % candidateIds.length];
    const voterRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
    const voteStartedAtMs = Date.now();

    if (Date.now() >= voteDeadlineMs) {
      return timeoutRow({
        index: index + 1,
        voter,
        candidateId,
      }, `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before this vote was submitted.`);
    }

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
  logStep(`Waiting for ${submittedSuccessRows.length} vote receipts with concurrency ${RECEIPT_WAIT_CONCURRENCY}...`);

  const confirmedRows = await mapWithConcurrency(submittedSuccessRows, RECEIPT_WAIT_CONCURRENCY, async (row) => {
    if (Date.now() >= voteDeadlineMs) {
      return timeoutRow(row, `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before receipt was checked.`);
    }

    try {
      const receipt = await waitForReceiptUntil(row.txHash, voteDeadlineMs);
      const status = toNumber(receipt.status);
      logStep(`Vote ${row.index}/${voterSigners.length} confirmed: voter=${row.voter}, candidate=${row.candidateId}, status=${status}, gas=${receipt.gasUsed.toString()}`);
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
  });

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
  logStep(`Vote mode: sequential. Vote run timeout: ${VOTE_RUN_TIMEOUT_MS} ms.`);

  for (const [index, signer] of voterSigners.entries()) {
    const voter = await signer.getAddress();
    const candidateId = candidateIds[index % candidateIds.length];

    if (Date.now() >= voteDeadlineMs) {
      logStep(`Vote run timeout reached before vote ${index + 1}/${voterSigners.length}. Remaining votes will be skipped.`);
      rows.push(timeoutRow({
        index: index + 1,
        voter,
        candidateId,
        skipped: true,
      }, `Vote run timeout after ${VOTE_RUN_TIMEOUT_MS}ms before this vote was submitted.`));
      continue;
    }

    const voterRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, signer);
    const voteStartedAtMs = Date.now();

    try {
      logStep(`Vote ${index + 1}/${voterSigners.length} submitting: voter=${voter}, candidate=${candidateId}`);
      const tx = await voterRoom.vote(candidateId, { gasPrice: 0 });
      logStep(`Vote ${index + 1}/${voterSigners.length} submitted: tx=${tx.hash}`);
      const receipt = await waitForReceiptUntil(tx.hash, voteDeadlineMs);
      const status = toNumber(receipt.status);
      logStep(`Vote ${index + 1}/${voterSigners.length} confirmed: voter=${voter}, candidate=${candidateId}, status=${status}, gas=${receipt.gasUsed.toString()}`);
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

async function inspectVoteResult(room, roomAddress, roundId, candidateIds) {
  const [onChainCandidateIds, onChainCandidateNames] = await room.getCandidates();
  const candidateNameById = new Map(onChainCandidateIds.map((id, index) => [toNumber(id), onChainCandidateNames[index]]));
  const candidates = [];

  for (const candidateId of candidateIds) {
    candidates.push({
      id: candidateId,
      name: candidateNameById.get(candidateId) || null,
      votes: toNumber(await room.getVotes(roundId, candidateId)),
    });
  }

  const events = await room.queryFilter(room.filters.VoteCast(roomAddress, roundId), 0, "latest");

  return {
    roundId,
    totalVotes: toNumber(await room.roundTotalVotes(roundId)),
    eventCount: events.length,
    candidates,
  };
}

async function stopRoomAfterVote(deployment, roomAddress) {
  try {
    const adminSigner = await getAdminSigner(deployment);
    const adminRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, adminSigner);
    const [roundId, state, readyToStart, startAt] = await adminRoom.getCurrentRoundStatus();

    if (toNumber(state) !== 1) {
      logStep(`Skipping stop(): room is not Active. Current state=${toNumber(state)}.`);
      return {
        attempted: false,
        skipped: true,
        reason: "Room is not Active.",
        statusBeforeStop: {
          roundId: toNumber(roundId),
          state: toNumber(state),
          readyToStart,
          startAt: toNumber(startAt),
        },
      };
    }

    logStep("Stopping room after vote...");
    const tx = await adminRoom.stop(await adminTxOverrides(() => adminRoom.stop.estimateGas({ gasPrice: 0 })));
    const receipt = await waitForTransaction(tx, "stop()", ADMIN_TX_TIMEOUT_MS);
    const [afterRoundId, afterState, afterReadyToStart, afterStartAt] = await adminRoom.getCurrentRoundStatus();

    return {
      attempted: true,
      ok: toNumber(receipt.status) === 1,
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: toNumber(receipt.blockNumber),
      statusAfterStop: {
        roundId: toNumber(afterRoundId),
        state: toNumber(afterState),
        readyToStart: afterReadyToStart,
        startAt: toNumber(afterStartAt),
      },
    };
  } catch (error) {
    logStep(`stop() failed after vote: ${error.shortMessage || error.message}`);
    return {
      attempted: true,
      ok: false,
      error: error.shortMessage || error.message,
    };
  }
}

async function ensureRoomCanVote(deployment, roomAddress, status) {
  const statusBeforeCheck = {
    roundId: toNumber(status.roundId),
    state: toNumber(status.state),
    readyToStart: status.readyToStart,
    startAt: toNumber(status.startAt),
  };

  if (statusBeforeCheck.state === 1) {
    return {
      ok: true,
      statusBeforeCheck,
      action: "none",
      statusForVote: statusBeforeCheck,
    };
  }

  if (statusBeforeCheck.state !== 0) {
    throw new Error(`Room state tidak valid untuk vote. Status: ${JSON.stringify(statusBeforeCheck)}`);
  }

  if (statusBeforeCheck.readyToStart) {
    const adminSigner = await getAdminSigner(deployment);
    const adminRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, adminSigner);
    logStep("Room is inactive and ready. Running start() before vote...");
    const tx = await adminRoom.start(await adminTxOverrides(() => adminRoom.start.estimateGas({ gasPrice: 0 })));
    const receipt = await waitForTransaction(tx, "start()", ADMIN_TX_TIMEOUT_MS);
    const [roundId, state, readyToStart, startAt] = await adminRoom.getCurrentRoundStatus();
    const statusAfterStart = {
      roundId: toNumber(roundId),
      state: toNumber(state),
      readyToStart,
      startAt: toNumber(startAt),
    };

    return {
      ok: true,
      statusBeforeCheck,
      action: "start",
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: toNumber(receipt.blockNumber),
      statusAfterStart,
      statusForVote: statusAfterStart,
    };
  }

  const reuseAction = (process.env.ROOM_REUSE_ACTION || "reset").toLowerCase();
  if (!["reset", "restart", "error"].includes(reuseAction)) {
    throw new Error("ROOM_REUSE_ACTION harus reset, restart, atau error");
  }
  if (reuseAction === "error") {
    throw new Error(
      `Room Inactive tetapi belum ready. Jalankan reset() atau restart() dulu. Status: ${JSON.stringify(statusBeforeCheck)}`
    );
  }

  const adminSigner = await getAdminSigner(deployment);
  const adminRoom = await hre.ethers.getContractAt("VotingRoom", roomAddress, adminSigner);
  logStep(`Room is inactive but not ready. Running ${reuseAction}() before vote check...`);
  const tx = reuseAction === "restart"
    ? await adminRoom.restart(await adminTxOverrides(() => adminRoom.restart.estimateGas({ gasPrice: 0 })))
    : await adminRoom.reset(await adminTxOverrides(() => adminRoom.reset.estimateGas({ gasPrice: 0 })));
  const receipt = await waitForTransaction(tx, `${reuseAction}()`, ADMIN_TX_TIMEOUT_MS);
  const [roundId, state, readyToStart, startAt] = await adminRoom.getCurrentRoundStatus();
  const statusAfterAction = {
    roundId: toNumber(roundId),
    state: toNumber(state),
    readyToStart,
    startAt: toNumber(startAt),
  };

  console.log(JSON.stringify({
    action: "room:vote-precheck",
    room: roomAddress,
    roomWasNotReady: true,
    reuseAction,
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    statusBeforeCheck,
    statusAfterAction,
    nextSteps: [
      "Jalankan npm run room:add-voter jika reset() dipakai atau voter belum sesuai.",
      "Jalankan npm run room:add-candidate jika reset() dipakai atau candidate belum sesuai.",
      "Ulangi npm run room:vote. Jika room sudah ready, script akan menjalankan start() otomatis.",
    ],
  }, null, 2));

  throw new Error(
    `Room belum bisa vote dan sudah menjalankan ${reuseAction}(). Room sekarang Inactive/ready. Jalankan add-voter, add-candidate, lalu ulangi room:vote.`
  );
}

async function vote(args) {
  const deployment = loadDeployment();
  const roomAddress = await getRoom(args);
  const candidateIds = getCandidateIds(args, DEFAULT_CANDIDATES.length);
  const voteMode = (process.env.VOTE_MODE || args.mode || args["vote-mode"] || DEFAULT_VOTE_MODE).toLowerCase();
  if (!["concurrent", "sequential"].includes(voteMode)) {
    throw new Error("VOTE_MODE harus concurrent atau sequential");
  }

  const voterSigners = getDefaultVoterSigners();
  const room = await hre.ethers.getContractAt("VotingRoom", roomAddress);
  const roomName = await room.roomName();
  const [roundId, state, readyToStart, startAt] = await room.getCurrentRoundStatus();
  const preVoteCheck = await ensureRoomCanVote(deployment, roomAddress, { roundId, state, readyToStart, startAt });
  const statusForVote = preVoteCheck.statusForVote;

  let voteRun = voteMode === "concurrent"
    ? await runConcurrentVotes(roomAddress, voterSigners, candidateIds)
    : await runSequentialVotes(roomAddress, voterSigners, candidateIds);
  voteRun = await refreshAvailableVoteReceipts(voteRun);
  const summary = summarizeVoteRun(voteRun);
  const onChain = await inspectVoteResult(room, roomAddress, statusForVote.roundId, candidateIds);
  const stopAfterVote = await stopRoomAfterVote(deployment, roomAddress);

  const result = {
    action: "vote",
    testName: `v5-room-30-eoa-${voteMode}-vote-manual`,
    room: roomAddress,
    roomName,
    deploymentAdmin: deployment.admin,
    network: hre.network.name,
    voteMode,
    candidateIds,
    voterCount: voterSigners.length,
    preVoteCheck,
    statusBeforeVote: {
      roundId: statusForVote.roundId,
      state: statusForVote.state,
      readyToStart: statusForVote.readyToStart,
      startAt: statusForVote.startAt,
    },
    voteRun: {
      ...voteRun,
      ...summary,
    },
    onChain,
    stopAfterVote,
    generatedAt: new Date().toISOString(),
  };

  if (voteMode === "concurrent") {
    result.concurrentVoting = result.voteRun;
  } else {
    result.sequentialVoting = result.voteRun;
  }

  const defaultResultDir = process.env.RESULT_RUN_DIR
    ? path.resolve(process.env.RESULT_RUN_DIR)
    : path.join(RESULTS_DIR, `${sanitizePathSegment(result.testName)}-${timestampForFolder()}`);
  const resultPath = path.join(defaultResultDir, `room-vote-manual-${Date.now()}.json`);
  writeJson(resultPath, result);

  console.log(JSON.stringify({
    action: "vote",
    room: roomAddress,
    roomName,
    voteMode,
    successCount: summary.successCount,
    failedCount: summary.failedCount,
    timeoutExceeded: voteRun.timeoutExceeded,
    totalVotesOnChain: onChain.totalVotes,
    stopAfterVote,
    resultPath,
  }, null, 2));
}

async function runAction(action) {
  const args = parseArgs(process.argv.slice(2));
  if (action === "reset") return resetRoom(args);
  if (action === "add-voter") return addVoter(args);
  if (action === "add-candidate") return addCandidate(args);
  if (action === "start") return startRoom(args);
  if (action === "stop") return stopRoom(args);
  if (action === "vote") return vote(args);
  throw new Error(`Unknown room action: ${action}`);
}

module.exports = { runAction };
