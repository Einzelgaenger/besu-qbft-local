const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const RESULTS_DIR = path.join(ROOT, "results");
const ACCOUNTS_PATH = path.join(ROOT, "accounts", "eoa-collections.json");
const HARDHAT_CLI = path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "cli.js");
const ROOM_TEST_SCRIPT = path.join("scripts", "run-room-test.js");

const DEFAULT_DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function logStep(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureResultsDir() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
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

function createRunResultDir(stageId) {
  const runDir = process.env.RESULT_RUN_DIR
    ? path.resolve(process.env.RESULT_RUN_DIR)
    : path.join(RESULTS_DIR, `${sanitizePathSegment(stageId)}-${timestampForFolder()}`);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function displayPath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
}

function toBigInt(value) {
  if (value === null || value === undefined) return 0n;
  return BigInt(value.toString());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function summarizeRoomResult(result, resultPath, runNumber, waveNumber, slotNumber) {
  const voteRun = result.voteRun || {};
  const inspect = result.inspect || {};

  return {
    runNumber,
    waveNumber,
    slotNumber,
    resultPath: displayPath(resultPath),
    room: result.room,
    roomName: result.roomName,
    voteMode: result.voteMode,
    accountOffset: result.accountOffset,
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
    retrySummary: voteRun.retrySummary || null,
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

async function fundAccountsIfNeeded(accounts, requiredCount, fundAmountEth) {
  const rpcUrl = process.env.BESU_RPC_URL || "http://127.0.0.1:8545";
  const privateKey = process.env.PRIVATE_KEY || DEFAULT_DEPLOYER_PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const funder = new ethers.Wallet(privateKey, provider);
  const funderAddress = await funder.getAddress();
  const fundAmount = ethers.parseEther(fundAmountEth);
  const minBalance = fundAmount / 2n;
  const requiredAccounts = accounts.slice(0, requiredCount);
  let nextNonce = await provider.getTransactionCount(funderAddress, "pending");

  logStep(`Preflight funding check for ${requiredAccounts.length} EOA accounts...`);
  for (const [index, account] of requiredAccounts.entries()) {
    const balance = await provider.getBalance(account.address);
    if (balance >= minBalance) {
      continue;
    }

    logStep(`Funding stress EOA ${index + 1}/${requiredAccounts.length}: ${account.address}`);
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const tx = await funder.sendTransaction({
          to: account.address,
          value: fundAmount,
          gasPrice: 0,
          nonce: nextNonce,
        });
        nextNonce += 1;
        await tx.wait();
        break;
      } catch (error) {
        const message = error?.shortMessage || error?.message || String(error);
        const isNonceError =
          error?.code === "NONCE_EXPIRED" ||
          message.toLowerCase().includes("nonce too low") ||
          message.toLowerCase().includes("nonce has already been used");

        if (!isNonceError || attempt === 5) {
          throw error;
        }

        logStep(`Funding nonce stale on attempt ${attempt}/5. Refreshing deployer nonce and retrying...`);
        nextNonce = await provider.getTransactionCount(funderAddress, "pending");
        await sleep(1000);
      }
    }
  }
}

function prefixOutput(stream, prefix) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`${prefix} ${line}`);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.trim().length > 0) {
      console.log(`${prefix} ${buffer}`);
    }
  });
}

function runRoomProcess(task, config, runDir) {
  return new Promise((resolve) => {
    const resultFileName = `room-vote-${sanitizePathSegment(config.stageId)}-run-${String(task.runNumber).padStart(3, "0")}-${Date.now()}.json`;
    const resultPath = path.join(runDir, resultFileName);
    const roomName = `${config.stageId}-room-${String(task.runNumber).padStart(3, "0")}`;
    const prefix = `[wave ${task.waveNumber} room ${task.runNumber}]`;

    const child = spawn(process.execPath, [HARDHAT_CLI, "run", ROOM_TEST_SCRIPT, "--network", "besu"], {
      cwd: ROOT,
      env: {
        ...process.env,
        ROOM_MODE: "new",
        ROOM_NAME: roomName,
        VOTE_MODE: "concurrent",
        ACCOUNT_OFFSET: String(task.accountOffset),
        VOTER_COUNT: String(config.votersPerRoom),
        RESULT_PATH: resultPath,
        VOTE_RUN_TIMEOUT_MS: process.env.VOTE_RUN_TIMEOUT_MS || config.voteRunTimeoutMs,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    prefixOutput(child.stdout, prefix);
    prefixOutput(child.stderr, prefix);

    child.on("error", (error) => {
      resolve({
        ok: false,
        runNumber: task.runNumber,
        waveNumber: task.waveNumber,
        slotNumber: task.slotNumber,
        accountOffset: task.accountOffset,
        resultPath: displayPath(resultPath),
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          runNumber: task.runNumber,
          waveNumber: task.waveNumber,
          slotNumber: task.slotNumber,
          accountOffset: task.accountOffset,
          resultPath: displayPath(resultPath),
          exitCode: code,
        });
        return;
      }

      try {
        const result = readJson(resultPath);
        resolve({
          ok: true,
          ...summarizeRoomResult(result, resultPath, task.runNumber, task.waveNumber, task.slotNumber),
        });
      } catch (error) {
        resolve({
          ok: false,
          runNumber: task.runNumber,
          waveNumber: task.waveNumber,
          slotNumber: task.slotNumber,
          accountOffset: task.accountOffset,
          resultPath: displayPath(resultPath),
          error: error.message,
        });
      }
    });
  });
}

async function runWave(waveTasks, config, runDir) {
  const startedAtMs = Date.now();
  const promises = [];
  const launchDelays = [];

  logStep(`Starting wave ${waveTasks[0].waveNumber}: ${waveTasks.length} TPS rooms parallel, stagger window ${config.staggerWindowMs} ms`);
  for (const task of waveTasks) {
    const delayMs = Math.floor(Math.random() * (config.staggerWindowMs + 1));
    launchDelays.push({
      runNumber: task.runNumber,
      slotNumber: task.slotNumber,
      delayMs,
    });
    promises.push((async () => {
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      logStep(`Launching room ${task.runNumber} in wave ${task.waveNumber}, slot ${task.slotNumber}, accountOffset=${task.accountOffset}, delay=${delayMs}ms`);
      return runRoomProcess(task, config, runDir);
    })());
  }

  const runs = await Promise.all(promises);
  return {
    waveNumber: waveTasks[0].waveNumber,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAtMs,
    launchDelays,
    runs,
  };
}

function summarizeWave(wave) {
  const successfulRuns = wave.runs.filter((run) => run.ok);
  const failedProcessRuns = wave.runs.filter((run) => !run.ok);
  const retrySummaries = successfulRuns.map((run) => run.retrySummary).filter(Boolean);
  const totals = retrySummaries.reduce((sum, retry) => ({
    totalSubmitRetries: sum.totalSubmitRetries + Number(retry.totalSubmitRetries || 0),
    votesRecoveredAfterRetry: sum.votesRecoveredAfterRetry + Number(retry.votesRecoveredAfterRetry || 0),
    failedAfterRetries: sum.failedAfterRetries + Number(retry.failedAfterRetries || 0),
    failedHealthProbeCount: sum.failedHealthProbeCount + Number(retry.failedHealthProbeCount || 0),
    healthWaitMs: sum.healthWaitMs + Number(retry.healthWaitMs || 0),
    systemUnreachableApproxMs: sum.systemUnreachableApproxMs + Number(retry.systemUnreachableApproxMs || 0),
    maxSubmitRetriesPerVote: Math.max(sum.maxSubmitRetriesPerVote, Number(retry.maxSubmitRetriesPerVote || 0)),
  }), {
    totalSubmitRetries: 0,
    votesRecoveredAfterRetry: 0,
    failedAfterRetries: 0,
    failedHealthProbeCount: 0,
    healthWaitMs: 0,
    systemUnreachableApproxMs: 0,
    maxSubmitRetriesPerVote: 0,
  });

  const successCount = successfulRuns.reduce((sum, run) => sum + Number(run.successCount || 0), 0);
  const failedVoteCount = successfulRuns.reduce((sum, run) => sum + Number(run.failedCount || 0), 0);
  const onChainVoteCount = successfulRuns.reduce((sum, run) => sum + Number(run.totalVotesOnChain || 0), 0);

  return {
    successCount,
    failedVoteCount,
    onChainVoteCount,
    failedProcessRoomCount: failedProcessRuns.length,
    ...totals,
    healthWaitSeconds: totals.healthWaitMs / 1000,
    systemUnreachableApproxSeconds: totals.systemUnreachableApproxMs / 1000,
  };
}

function decideNextWaveDelay(config, wave, currentBaseDelayMs) {
  const summary = summarizeWave(wave);
  let nextBaseDelayMs = currentBaseDelayMs;
  const reasons = [];

  if (summary.failedProcessRoomCount > 0 || summary.failedVoteCount > 0 || summary.failedAfterRetries > 0) {
    nextBaseDelayMs += config.dynamicDelayIncreaseMs;
    reasons.push("failed vote/process detected");
  }
  if (summary.failedHealthProbeCount >= config.dynamicDelayFailedProbeThreshold) {
    nextBaseDelayMs += config.dynamicDelayIncreaseMs;
    reasons.push(`failed health probes >= ${config.dynamicDelayFailedProbeThreshold}`);
  }
  if (summary.healthWaitMs >= config.dynamicDelayHealthWaitThresholdMs) {
    nextBaseDelayMs += config.dynamicDelayIncreaseMs;
    reasons.push(`health wait >= ${config.dynamicDelayHealthWaitThresholdMs}ms`);
  }
  if (reasons.length === 0 && summary.totalSubmitRetries === 0) {
    nextBaseDelayMs -= config.dynamicDelayDecreaseMs;
    reasons.push("stable wave");
  }

  nextBaseDelayMs = clamp(nextBaseDelayMs, config.dynamicWaveDelayMinMs, config.dynamicWaveDelayMaxMs);
  const jitterMs = config.dynamicWaveDelayJitterMs > 0
    ? Math.floor(Math.random() * (config.dynamicWaveDelayJitterMs + 1))
    : 0;
  const actualDelayMs = clamp(nextBaseDelayMs + jitterMs, config.dynamicWaveDelayMinMs, config.dynamicWaveDelayMaxMs);

  return {
    enabled: true,
    previousBaseDelayMs: currentBaseDelayMs,
    nextBaseDelayMs,
    jitterMs,
    actualDelayMs,
    reasons,
    waveSummary: summary,
  };
}

function buildAggregate(config, startedAtMs, waves) {
  const runs = waves.flatMap((wave) => wave.runs);
  const successfulRuns = runs.filter((run) => run.ok);
  const failedProcessRuns = runs.filter((run) => !run.ok);
  const totalSuccess = successfulRuns.reduce((sum, run) => sum + Number(run.successCount || 0), 0);
  const totalFailedVotes = successfulRuns.reduce((sum, run) => sum + Number(run.failedCount || 0), 0);
  const totalVotesOnChain = successfulRuns.reduce((sum, run) => sum + Number(run.totalVotesOnChain || 0), 0);
  const totalEvents = successfulRuns.reduce((sum, run) => sum + Number(run.eventCount || 0), 0);
  const totalGasUsed = successfulRuns.reduce((sum, run) => sum + toBigInt(run.totalGasUsed), 0n);
  const retrySummaries = successfulRuns.map((run) => run.retrySummary).filter(Boolean);
  const retryTotals = retrySummaries.reduce((totals, retry) => ({
    totalSubmitAttempts: totals.totalSubmitAttempts + Number(retry.totalSubmitAttempts || 0),
    totalSubmitRetries: totals.totalSubmitRetries + Number(retry.totalSubmitRetries || 0),
    votesWithRetry: totals.votesWithRetry + Number(retry.votesWithRetry || 0),
    votesRecoveredAfterRetry: totals.votesRecoveredAfterRetry + Number(retry.votesRecoveredAfterRetry || 0),
    failedAfterRetries: totals.failedAfterRetries + Number(retry.failedAfterRetries || 0),
    confirmedByContractStateCount: totals.confirmedByContractStateCount + Number(retry.confirmedByContractStateCount || 0),
    recoveredByFinalReconciliationCount: totals.recoveredByFinalReconciliationCount + Number(retry.recoveredByFinalReconciliationCount || 0),
    revertedButAlreadyVotedCount: totals.revertedButAlreadyVotedCount + Number(retry.revertedButAlreadyVotedCount || 0),
    retryRecoveryCount: totals.retryRecoveryCount + Number(retry.retryRecoveryCount || 0),
    totalRetryRecoveryElapsedMs: totals.totalRetryRecoveryElapsedMs + Number(retry.totalRetryRecoveryElapsedMs || 0),
    maxRetryRecoveryElapsedMs: Math.max(totals.maxRetryRecoveryElapsedMs, Number(retry.maxRetryRecoveryElapsedMs || 0)),
    maxSubmitAttemptsPerVote: Math.max(totals.maxSubmitAttemptsPerVote, Number(retry.maxSubmitAttemptsPerVote || 0)),
    maxSubmitRetriesPerVote: Math.max(totals.maxSubmitRetriesPerVote, Number(retry.maxSubmitRetriesPerVote || 0)),
    healthCheckCount: totals.healthCheckCount + Number(retry.healthCheckCount || 0),
    failedHealthProbeCount: totals.failedHealthProbeCount + Number(retry.failedHealthProbeCount || 0),
    healthWaitMs: totals.healthWaitMs + Number(retry.healthWaitMs || 0),
    systemUnreachableApproxMs: totals.systemUnreachableApproxMs + Number(retry.systemUnreachableApproxMs || 0),
  }), {
    totalSubmitAttempts: 0,
    totalSubmitRetries: 0,
    votesWithRetry: 0,
    votesRecoveredAfterRetry: 0,
    failedAfterRetries: 0,
    confirmedByContractStateCount: 0,
    recoveredByFinalReconciliationCount: 0,
    revertedButAlreadyVotedCount: 0,
    retryRecoveryCount: 0,
    totalRetryRecoveryElapsedMs: 0,
    maxRetryRecoveryElapsedMs: 0,
    maxSubmitAttemptsPerVote: 0,
    maxSubmitRetriesPerVote: 0,
    healthCheckCount: 0,
    failedHealthProbeCount: 0,
    healthWaitMs: 0,
    systemUnreachableApproxMs: 0,
  });
  const expectedVoteTransactions = config.totalTps * config.votersPerRoom;

  return {
    stageId: config.stageId,
    stageName: config.stageName,
    purpose: config.purpose,
    sampleUnit: "tps-room",
    testType: "staggered-parallel-tps",
    populationTps: config.populationTps,
    targetSampleTps: config.totalTps,
    expectedTpsSamples: config.totalTps,
    tpsRoomCount: config.totalTps,
    parallelRooms: config.parallelRooms,
    votersPerRoom: config.votersPerRoom,
    requiredUniqueEoaPerWave: config.requiredUniqueEoaPerWave,
    expectedVoteTransactions,
    voteMode: "concurrent",
    staggerWindowMs: config.staggerWindowMs,
    waveDelayMs: config.waveDelayMs,
    dynamicWaveDelay: {
      enabled: config.dynamicWaveDelayEnabled,
      minMs: config.dynamicWaveDelayMinMs,
      maxMs: config.dynamicWaveDelayMaxMs,
      jitterMs: config.dynamicWaveDelayJitterMs,
      increaseMs: config.dynamicDelayIncreaseMs,
      decreaseMs: config.dynamicDelayDecreaseMs,
      failedProbeThreshold: config.dynamicDelayFailedProbeThreshold,
      healthWaitThresholdMs: config.dynamicDelayHealthWaitThresholdMs,
    },
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAtMs,
    totals: {
      successCount: totalSuccess,
      failedVoteCount: totalFailedVotes,
      failedProcessRoomCount: failedProcessRuns.length,
      totalVotesOnChain,
      eventCount: totalEvents,
      totalGasUsed: totalGasUsed.toString(),
      timeoutRunCount: successfulRuns.filter((run) => run.timeoutExceeded).length,
    },
    retryTotals: {
      ...retryTotals,
      averageSubmitAttemptsPerVote: expectedVoteTransactions > 0 ? retryTotals.totalSubmitAttempts / expectedVoteTransactions : null,
      averageSubmitRetriesPerVote: expectedVoteTransactions > 0 ? retryTotals.totalSubmitRetries / expectedVoteTransactions : null,
      averageRetryRecoveryElapsedMs: retryTotals.retryRecoveryCount > 0 ? retryTotals.totalRetryRecoveryElapsedMs / retryTotals.retryRecoveryCount : null,
      healthWaitSeconds: retryTotals.healthWaitMs / 1000,
      systemUnreachableApproxSeconds: retryTotals.systemUnreachableApproxMs / 1000,
    },
    averages: {
      avgLatencyMs: weightedAverage(successfulRuns, "avgLatencyMs", "successCount"),
      avgGasUsed: totalSuccess > 0 ? Number(totalGasUsed) / totalSuccess : null,
    },
    waves,
  };
}

async function runStaggeredParallelTpsStage(configInput) {
  ensureResultsDir();
  const config = {
    ...configInput,
    populationTps: Number(process.env.POPULATION_TPS || configInput.populationTps || 3000),
    totalTps: Number(process.env.STRESS_TOTAL_TPS || process.env.SAMPLING_ROOM_COUNT || configInput.totalTps),
    parallelRooms: Number(process.env.STRESS_PARALLEL_ROOMS || configInput.parallelRooms || 5),
    votersPerRoom: Number(process.env.STRESS_VOTERS_PER_ROOM || configInput.votersPerRoom || 30),
    staggerWindowMs: Number(process.env.STRESS_STAGGER_WINDOW_MS || configInput.staggerWindowMs || 5000),
    waveDelayMs: Number(process.env.STRESS_WAVE_DELAY_MS || configInput.waveDelayMs || 10000),
    voteRunTimeoutMs: process.env.VOTE_RUN_TIMEOUT_MS || configInput.voteRunTimeoutMs || "120000",
    dynamicWaveDelayEnabled: (process.env.STRESS_DYNAMIC_WAVE_DELAY_ENABLED || configInput.dynamicWaveDelayEnabled || "false").toString().toLowerCase() === "true",
    dynamicWaveDelayMinMs: Number(process.env.STRESS_WAVE_DELAY_MIN_MS || configInput.dynamicWaveDelayMinMs || 10000),
    dynamicWaveDelayMaxMs: Number(process.env.STRESS_WAVE_DELAY_MAX_MS || configInput.dynamicWaveDelayMaxMs || 30000),
    dynamicWaveDelayJitterMs: Number(process.env.STRESS_WAVE_DELAY_JITTER_MS || configInput.dynamicWaveDelayJitterMs || 5000),
    dynamicDelayIncreaseMs: Number(process.env.STRESS_WAVE_DELAY_INCREASE_MS || configInput.dynamicDelayIncreaseMs || 5000),
    dynamicDelayDecreaseMs: Number(process.env.STRESS_WAVE_DELAY_DECREASE_MS || configInput.dynamicDelayDecreaseMs || 2000),
    dynamicDelayFailedProbeThreshold: Number(process.env.STRESS_WAVE_DELAY_FAILED_PROBE_THRESHOLD || configInput.dynamicDelayFailedProbeThreshold || 20),
    dynamicDelayHealthWaitThresholdMs: Number(process.env.STRESS_WAVE_DELAY_HEALTH_WAIT_THRESHOLD_MS || configInput.dynamicDelayHealthWaitThresholdMs || 60000),
  };
  config.requiredUniqueEoaPerWave = config.parallelRooms * config.votersPerRoom;

  const accountPayload = readJson(ACCOUNTS_PATH);
  const accounts = accountPayload.accounts || [];
  if (accounts.length < config.requiredUniqueEoaPerWave) {
    throw new Error(
      `Staggered parallel test needs at least ${config.requiredUniqueEoaPerWave} EOA accounts for ${config.parallelRooms} parallel rooms x ${config.votersPerRoom} voters. Found ${accounts.length}. Run: $env:ACCOUNT_COUNT="${config.requiredUniqueEoaPerWave}"; npm run generate:eoa`
    );
  }

  await fundAccountsIfNeeded(accounts, config.requiredUniqueEoaPerWave, process.env.FUND_AMOUNT || "1");

  const startedAtMs = Date.now();
  const runDir = createRunResultDir(config.stageId);
  const waves = [];
  const totalWaves = Math.ceil(config.totalTps / config.parallelRooms);
  let runNumber = 1;
  let currentWaveDelayMs = config.waveDelayMs;

  logStep(`Starting ${config.stageName}`);
  logStep(`Result folder: ${displayPath(runDir)}`);
  logStep(`Target: ${config.totalTps} TPS rooms, ${config.parallelRooms} rooms parallel per wave, ${config.votersPerRoom} vote concurrent per room`);
  logStep(`Required unique EOA per wave: ${config.requiredUniqueEoaPerWave}. Reused only after each wave completes.`);

  for (let waveNumber = 1; waveNumber <= totalWaves; waveNumber++) {
    const waveTasks = [];
    for (let slotNumber = 1; slotNumber <= config.parallelRooms && runNumber <= config.totalTps; slotNumber++) {
      waveTasks.push({
        runNumber,
        waveNumber,
        slotNumber,
        accountOffset: (slotNumber - 1) * config.votersPerRoom,
      });
      runNumber += 1;
    }

    const wave = await runWave(waveTasks, config, runDir);
    waves.push(wave);

    if (waveNumber < totalWaves && currentWaveDelayMs > 0) {
      let delayDecision = {
        enabled: false,
        actualDelayMs: currentWaveDelayMs,
        reasons: ["fixed wave delay"],
        waveSummary: summarizeWave(wave),
      };

      if (config.dynamicWaveDelayEnabled) {
        delayDecision = decideNextWaveDelay(config, wave, currentWaveDelayMs);
        currentWaveDelayMs = delayDecision.nextBaseDelayMs;
      }

      wave.nextWaveDelay = delayDecision;
      logStep(`Waiting ${delayDecision.actualDelayMs} ms before next wave (${delayDecision.reasons.join("; ")})...`);
      await sleep(delayDecision.actualDelayMs);
    }
  }

  const aggregate = buildAggregate(config, startedAtMs, waves);
  aggregate.resultFolder = displayPath(runDir);
  const aggregatePath = path.join(runDir, `sampling-${config.stageId}-${Date.now()}.json`);
  writeJson(aggregatePath, aggregate);

  console.log(JSON.stringify({
    stageId: aggregate.stageId,
    stageName: aggregate.stageName,
    testType: aggregate.testType,
    expectedTpsSamples: aggregate.expectedTpsSamples,
    parallelRooms: aggregate.parallelRooms,
    expectedVoteTransactions: aggregate.expectedVoteTransactions,
    successCount: aggregate.totals.successCount,
    failedVoteCount: aggregate.totals.failedVoteCount,
    failedProcessRoomCount: aggregate.totals.failedProcessRoomCount,
    totalVotesOnChain: aggregate.totals.totalVotesOnChain,
    eventCount: aggregate.totals.eventCount,
    retryTotals: aggregate.retryTotals,
    avgLatencyMs: aggregate.averages.avgLatencyMs,
    avgGasUsed: aggregate.averages.avgGasUsed,
    resultFolder: displayPath(runDir),
    resultPath: displayPath(aggregatePath),
  }, null, 2));
}

module.exports = { runStaggeredParallelTpsStage };
