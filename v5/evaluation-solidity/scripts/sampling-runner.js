const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const RESULTS_DIR = path.join(ROOT, "results");
const ROOM_TEST_SCRIPT = path.join("scripts", "run-room-test.js");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "cli.js");

function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  ensureResultsDir();
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function displayPath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
}

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }

  return result;
}

function listRoomResultFiles() {
  ensureResultsDir();
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((fileName) => /^room-vote-\d+\.json$/.test(fileName))
    .map((fileName) => {
      const filePath = path.join(RESULTS_DIR, fileName);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function findNewestRoomResult(startedAtMs) {
  const files = listRoomResultFiles();
  const result = files.find((file) => file.mtimeMs >= startedAtMs - 1000) || files[0];
  if (!result) {
    throw new Error("No room-vote result file was created.");
  }
  return result.filePath;
}

function toBigInt(value) {
  if (value === null || value === undefined) return 0n;
  return BigInt(value.toString());
}

function summarizeRoomResult(result, resultPath, runNumber) {
  const voteRun = result.voteRun || {};
  const inspect = result.inspect || {};

  return {
    runNumber,
    resultPath: displayPath(resultPath),
    room: result.room,
    roomName: result.roomName,
    voteMode: result.voteMode,
    voterCount: result.voterCount,
    successCount: voteRun.successCount ?? 0,
    failedCount: voteRun.failedCount ?? 0,
    timeoutExceeded: Boolean(voteRun.timeoutExceeded),
    elapsedMs: voteRun.elapsedMs ?? null,
    minLatencyMs: voteRun.minLatencyMs ?? null,
    maxLatencyMs: voteRun.maxLatencyMs ?? null,
    avgLatencyMs: voteRun.avgLatencyMs ?? null,
    totalGasUsed: voteRun.totalGasUsed ?? "0",
    avgGasUsed: voteRun.avgGasUsed ?? null,
    totalVotesOnChain: inspect.totalVotes ?? null,
    eventCount: inspect.eventCount ?? null,
    candidates: inspect.candidates || [],
    measuredAt: result.measuredAt,
  };
}

function weightedAverage(rows, valueKey, weightKey) {
  let weightedSum = 0;
  let weightSum = 0;

  for (const row of rows) {
    const value = row[valueKey];
    const weight = Number(row[weightKey] || 0);
    if (typeof value === "number" && Number.isFinite(value) && weight > 0) {
      weightedSum += value * weight;
      weightSum += weight;
    }
  }

  return weightSum > 0 ? weightedSum / weightSum : null;
}

function buildAggregate(config, startedAtMs, finishedAtMs, runs) {
  const totalSuccess = runs.reduce((sum, run) => sum + Number(run.successCount || 0), 0);
  const totalFailed = runs.reduce((sum, run) => sum + Number(run.failedCount || 0), 0);
  const totalVotesOnChain = runs.reduce((sum, run) => sum + Number(run.totalVotesOnChain || 0), 0);
  const totalEvents = runs.reduce((sum, run) => sum + Number(run.eventCount || 0), 0);
  const totalGasUsed = runs.reduce((sum, run) => sum + toBigInt(run.totalGasUsed), 0n);
  const eoaPerRoom = config.eoaPerRoom || 30;
  const expectedVoteTransactions = config.roomCount * eoaPerRoom;
  const sampleUnit = config.sampleUnit || "vote";
  const expectedTpsSamples = sampleUnit === "tps-room" ? config.roomCount : config.targetSampleTps;

  return {
    stageId: config.stageId,
    stageName: config.stageName,
    purpose: config.purpose,
    sampleUnit,
    populationTps: config.populationTps,
    targetSampleTps: config.targetSampleTps,
    expectedTpsSamples,
    roomCount: config.roomCount,
    tpsRoomCount: sampleUnit === "tps-room" ? config.roomCount : null,
    eoaPerRoom,
    votesPerTpsRoom: sampleUnit === "tps-room" ? eoaPerRoom : null,
    expectedVoteSamples: expectedVoteTransactions,
    expectedVoteTransactions,
    voteMode: config.voteMode,
    faultTolerance: config.faultTolerance || null,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    elapsedMs: finishedAtMs - startedAtMs,
    totals: {
      successCount: totalSuccess,
      failedCount: totalFailed,
      totalVotesOnChain,
      eventCount: totalEvents,
      totalGasUsed: totalGasUsed.toString(),
      timeoutRunCount: runs.filter((run) => run.timeoutExceeded).length,
    },
    averages: {
      avgLatencyMs: weightedAverage(runs, "avgLatencyMs", "successCount"),
      avgGasUsed: totalSuccess > 0 ? Number(totalGasUsed) / totalSuccess : null,
    },
    runs,
  };
}

function runSingleRoomTest(config, runNumber) {
  const startedAtMs = Date.now();
  const roomName = `${config.stageId}-room-${String(runNumber).padStart(2, "0")}`;

  logStep(`Running ${config.stageName}: room ${runNumber}/${config.roomCount}, mode=${config.voteMode}`);
  runCommand(process.execPath, [HARDHAT_CLI, "run", ROOM_TEST_SCRIPT, "--network", "besu"], {
    env: {
      ...process.env,
      ROOM_MODE: "new",
      ROOM_NAME: roomName,
      VOTE_MODE: config.voteMode,
      VOTE_RUN_TIMEOUT_MS: process.env.VOTE_RUN_TIMEOUT_MS || config.voteRunTimeoutMs || "60000",
    },
  });

  const resultPath = findNewestRoomResult(startedAtMs);
  const result = readJson(resultPath);
  const summary = summarizeRoomResult(result, resultPath, runNumber);

  logStep(
    `Completed room ${runNumber}/${config.roomCount}: success=${summary.successCount}, failed=${summary.failedCount}, result=${displayPath(resultPath)}`
  );

  return summary;
}

function runSamplingStage(config) {
  ensureResultsDir();
  const startedAtMs = Date.now();
  const runs = [];
  const roomDelayMs = Number(process.env.SAMPLING_ROOM_DELAY_MS || config.roomDelayMs || 3000);
  const sampleUnit = config.sampleUnit || "vote";
  const roomLabel = sampleUnit === "tps-room" ? "TPS room" : "room";

  logStep(`Starting ${config.stageName}`);
  logStep(`Target: ${config.roomCount} ${roomLabel} x ${config.eoaPerRoom || 30} EOA = ${config.roomCount * (config.eoaPerRoom || 30)} vote transactions`);

  for (let i = 1; i <= config.roomCount; i++) {
    runs.push(runSingleRoomTest(config, i));
    if (i < config.roomCount && roomDelayMs > 0) {
      logStep(`Waiting ${roomDelayMs} ms before next room...`);
      sleepSync(roomDelayMs);
    }
  }

  const finishedAtMs = Date.now();
  const aggregate = buildAggregate(config, startedAtMs, finishedAtMs, runs);
  const aggregatePath = path.join(RESULTS_DIR, `sampling-${config.stageId}-${Date.now()}.json`);
  writeJson(aggregatePath, aggregate);

  console.log(JSON.stringify({
    stageId: aggregate.stageId,
    stageName: aggregate.stageName,
    sampleUnit: aggregate.sampleUnit,
    voteMode: aggregate.voteMode,
    expectedTpsSamples: aggregate.expectedTpsSamples,
    tpsRoomCount: aggregate.tpsRoomCount,
    expectedVoteSamples: aggregate.expectedVoteSamples,
    expectedVoteTransactions: aggregate.expectedVoteTransactions,
    successCount: aggregate.totals.successCount,
    failedCount: aggregate.totals.failedCount,
    totalVotesOnChain: aggregate.totals.totalVotesOnChain,
    eventCount: aggregate.totals.eventCount,
    avgLatencyMs: aggregate.averages.avgLatencyMs,
    avgGasUsed: aggregate.averages.avgGasUsed,
    resultPath: displayPath(aggregatePath),
  }, null, 2));

  return aggregate;
}

module.exports = {
  ROOT,
  logStep,
  runCommand,
  runSamplingStage,
  sleepSync,
};
