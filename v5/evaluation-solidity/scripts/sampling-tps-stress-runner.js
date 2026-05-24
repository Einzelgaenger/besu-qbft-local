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
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const V5_ROOT = path.join(ROOT, "..");

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

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRpcUrls() {
  const configured = parseList(process.env.STRESS_RPC_URLS || process.env.BESU_RPC_URLS);
  if (configured.length > 0) {
    return configured;
  }
  return [process.env.BESU_RPC_URL || DEFAULT_RPC_URL];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + Number(value || 0);
  }
  return target;
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
    rpcUrl: result.rpcUrl || result.system?.rpcUrl || null,
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
    avgSuccessfulAttemptLatencyMs: voteRun.avgSuccessfulAttemptLatencyMs ?? voteRun.avgLatencyMs ?? null,
    avgTotalVoteElapsedMs: voteRun.avgTotalVoteElapsedMs ?? null,
    avgRetryRecoveryElapsedMs: voteRun.avgRetryRecoveryElapsedMs ?? null,
    latencyPercentiles: voteRun.latencyPercentiles || null,
    totalVoteElapsedPercentiles: voteRun.totalVoteElapsedPercentiles || null,
    retryRecoveryElapsedPercentiles: voteRun.retryRecoveryElapsedPercentiles || null,
    totalGasUsed: voteRun.totalGasUsed ?? "0",
    avgGasUsed: voteRun.avgGasUsed ?? null,
    totalVotesOnChain: inspect.totalVotes ?? null,
    eventCount: inspect.eventCount ?? null,
    candidates: inspect.candidates || [],
    retrySummary: voteRun.retrySummary || null,
    retryRecoveryCount: voteRun.retrySummary?.retryRecoveryCount ?? 0,
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

function directorySizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        total += fs.statSync(entryPath).size;
      }
    }
  }
  return total;
}

function snapshotNodeStorage() {
  const nodes = {};
  for (let i = 1; i <= 4; i++) {
    const dataPath = path.join(V5_ROOT, "nodes", `node${i}`, "data");
    const bytes = directorySizeBytes(dataPath);
    nodes[`node${i}`] = {
      path: dataPath,
      bytes,
      mb: bytes === null ? null : bytes / (1024 * 1024),
    };
  }
  return nodes;
}

async function checkRpcEndpoint(rpcUrl) {
  const startedAtMs = Date.now();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const result = {
    rpcUrl,
    ok: false,
    checkedAt: new Date(startedAtMs).toISOString(),
    elapsedMs: null,
    blockNumber: null,
    txpool: null,
    error: null,
  };

  try {
    result.blockNumber = await provider.getBlockNumber();
    try {
      result.txpool = await provider.send("txpool_besuStatistics", []);
    } catch (error) {
      result.txpool = {
        ok: false,
        error: error?.shortMessage || error?.message || String(error),
      };
    }
    result.ok = true;
  } catch (error) {
    result.error = error?.shortMessage || error?.message || String(error);
  } finally {
    result.elapsedMs = Date.now() - startedAtMs;
    if (provider.destroy) {
      provider.destroy();
    }
  }

  return result;
}

async function snapshotRpcHealth(rpcUrls) {
  return Promise.all(rpcUrls.map((rpcUrl) => checkRpcEndpoint(rpcUrl)));
}

async function waitForRpcHealth(rpcUrls, label, timeoutMs, intervalMs, requireAll = true) {
  const startedAtMs = Date.now();
  let lastSnapshot = [];
  let probeCount = 0;

  while (Date.now() - startedAtMs <= timeoutMs) {
    probeCount += 1;
    lastSnapshot = await snapshotRpcHealth(rpcUrls);
    const healthyCount = lastSnapshot.filter((rpc) => rpc.ok).length;
    const ok = requireAll ? healthyCount === lastSnapshot.length : healthyCount > 0;
    if (ok) {
      return {
        ok: true,
        label,
        requireAll,
        healthyCount,
        requiredHealthyCount: requireAll ? lastSnapshot.length : 1,
        waitedMs: Date.now() - startedAtMs,
        probeCount,
        snapshot: lastSnapshot,
      };
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    label,
    requireAll,
    healthyCount: lastSnapshot.filter((rpc) => rpc.ok).length,
    requiredHealthyCount: requireAll ? rpcUrls.length : 1,
    waitedMs: Date.now() - startedAtMs,
    probeCount,
    snapshot: lastSnapshot,
  };
}

async function fundAccountsIfNeeded(accounts, requiredCount, fundAmountEth, rpcUrls) {
  const rpcUrl = rpcUrls[0] || process.env.BESU_RPC_URL || DEFAULT_RPC_URL;
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
        BESU_RPC_URL: task.rpcUrl,
        RPC_ENDPOINT_LABEL: task.rpcLabel,
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
        rpcUrl: task.rpcUrl,
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
          rpcUrl: task.rpcUrl,
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
          rpcUrl: task.rpcUrl,
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
      logStep(`Launching room ${task.runNumber} in wave ${task.waveNumber}, slot ${task.slotNumber}, accountOffset=${task.accountOffset}, rpc=${task.rpcUrl}, delay=${delayMs}ms`);
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
    submitAttemptDistribution: mergeCounts(totals.submitAttemptDistribution, retry.submitAttemptDistribution),
    submitRetryDistribution: mergeCounts(totals.submitRetryDistribution, retry.submitRetryDistribution),
    failureReasonCounts: mergeCounts(totals.failureReasonCounts, retry.failureReasonCounts),
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
    submitAttemptDistribution: {},
    submitRetryDistribution: {},
    failureReasonCounts: {},
  });
  const expectedVoteTransactions = config.totalTps * config.votersPerRoom;
  const rpcSummary = successfulRuns.reduce((summary, run) => {
    const key = run.rpcUrl || "unknown";
    if (!summary[key]) {
      summary[key] = {
        runCount: 0,
        successCount: 0,
        failedCount: 0,
        totalVotesOnChain: 0,
        totalSubmitRetries: 0,
        failedHealthProbeCount: 0,
      };
    }
    summary[key].runCount += 1;
    summary[key].successCount += Number(run.successCount || 0);
    summary[key].failedCount += Number(run.failedCount || 0);
    summary[key].totalVotesOnChain += Number(run.totalVotesOnChain || 0);
    summary[key].totalSubmitRetries += Number(run.retrySummary?.totalSubmitRetries || 0);
    summary[key].failedHealthProbeCount += Number(run.retrySummary?.failedHealthProbeCount || 0);
    return summary;
  }, {});

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
    rpcUrls: config.rpcUrls,
    preflightRpcHealth: {
      enabled: config.preflightRpcHealthEnabled,
      requireAll: config.preflightRpcHealthRequireAll,
      timeoutMs: config.preflightRpcHealthTimeoutMs,
      intervalMs: config.preflightRpcHealthIntervalMs,
    },
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
    rpcSummary,
    averages: {
      avgLatencyMs: weightedAverage(successfulRuns, "avgLatencyMs", "successCount"),
      avgSuccessfulAttemptLatencyMs: weightedAverage(successfulRuns, "avgSuccessfulAttemptLatencyMs", "successCount"),
      avgTotalVoteElapsedMs: weightedAverage(successfulRuns, "avgTotalVoteElapsedMs", "successCount"),
      avgRetryRecoveryElapsedMs: weightedAverage(successfulRuns, "avgRetryRecoveryElapsedMs", "retryRecoveryCount"),
      avgGasUsed: totalSuccess > 0 ? Number(totalGasUsed) / totalSuccess : null,
    },
    waves,
  };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvValue).join(","),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function writeAggregateReports(aggregate, runDir) {
  const roomRows = aggregate.waves.flatMap((wave) => wave.runs.map((run) => ({
    waveNumber: wave.waveNumber,
    runNumber: run.runNumber,
    ok: run.ok,
    roomName: run.roomName,
    rpcUrl: run.rpcUrl,
    successCount: run.successCount,
    failedCount: run.failedCount,
    totalVotesOnChain: run.totalVotesOnChain,
    eventCount: run.eventCount,
    avgSuccessfulAttemptLatencyMs: run.avgSuccessfulAttemptLatencyMs,
    avgTotalVoteElapsedMs: run.avgTotalVoteElapsedMs,
    avgRetryRecoveryElapsedMs: run.avgRetryRecoveryElapsedMs,
    retryRecoveryCount: run.retryRecoveryCount,
    totalSubmitRetries: run.retrySummary?.totalSubmitRetries ?? 0,
    averageSubmitRetriesPerVote: run.retrySummary?.averageSubmitRetriesPerVote ?? 0,
    maxSubmitRetriesPerVote: run.retrySummary?.maxSubmitRetriesPerVote ?? 0,
    votesRecoveredAfterRetry: run.retrySummary?.votesRecoveredAfterRetry ?? 0,
    confirmedByContractStateCount: run.retrySummary?.confirmedByContractStateCount ?? 0,
    recoveredByFinalReconciliationCount: run.retrySummary?.recoveredByFinalReconciliationCount ?? 0,
    failedHealthProbeCount: run.retrySummary?.failedHealthProbeCount ?? 0,
    healthWaitSeconds: run.retrySummary?.healthWaitSeconds ?? 0,
    systemUnreachableApproxSeconds: run.retrySummary?.systemUnreachableApproxSeconds ?? 0,
    timeoutExceeded: run.timeoutExceeded,
    exitCode: run.exitCode ?? "",
    error: run.error ?? "",
    resultPath: run.resultPath,
  })));

  const waveRows = aggregate.waves.map((wave) => {
    const summary = summarizeWave(wave);
    return {
      waveNumber: wave.waveNumber,
      runCount: wave.runs.length,
      elapsedMs: wave.elapsedMs,
      successCount: summary.successCount,
      failedCount: summary.failedVoteCount,
      totalVotesOnChain: summary.onChainVoteCount,
      totalSubmitRetries: summary.totalSubmitRetries,
      failedHealthProbeCount: summary.failedHealthProbeCount,
      healthWaitSeconds: summary.healthWaitSeconds,
      nextWaveDelayMs: wave.nextWaveDelay?.actualDelayMs ?? "",
      delayReasons: (wave.nextWaveDelay?.reasons || []).join("; "),
    };
  });

  writeCsv(path.join(runDir, "summary-rooms.csv"), roomRows);
  writeCsv(path.join(runDir, "summary-waves.csv"), waveRows);

  const successRate = aggregate.expectedVoteTransactions > 0
    ? (aggregate.totals.successCount / aggregate.expectedVoteTransactions) * 100
    : 0;
  const onChainRate = aggregate.expectedVoteTransactions > 0
    ? (aggregate.totals.totalVotesOnChain / aggregate.expectedVoteTransactions) * 100
    : 0;
  const markdown = [
    `# ${aggregate.stageName}`,
    "",
    `- Stage ID: \`${aggregate.stageId}\``,
    `- Test type: \`${aggregate.testType}\``,
    `- TPS rooms: ${aggregate.tpsRoomCount}`,
    `- Parallel rooms per wave: ${aggregate.parallelRooms}`,
    `- Expected vote transactions: ${aggregate.expectedVoteTransactions}`,
    `- Success count: ${aggregate.totals.successCount} (${successRate.toFixed(2)}%)`,
    `- Failed vote count: ${aggregate.totals.failedVoteCount}`,
    `- On-chain votes: ${aggregate.totals.totalVotesOnChain} (${onChainRate.toFixed(2)}%)`,
    `- Event count: ${aggregate.totals.eventCount}`,
    `- Elapsed: ${aggregate.elapsedMs} ms`,
    `- Avg successful attempt latency: ${aggregate.averages.avgSuccessfulAttemptLatencyMs ?? "n/a"} ms`,
    `- Avg total vote elapsed: ${aggregate.averages.avgTotalVoteElapsedMs ?? "n/a"} ms`,
    `- Total submit retries: ${aggregate.retryTotals.totalSubmitRetries}`,
    `- Average submit retries per vote: ${aggregate.retryTotals.averageSubmitRetriesPerVote ?? "n/a"}`,
    `- Max submit retries per vote: ${aggregate.retryTotals.maxSubmitRetriesPerVote}`,
    `- Votes recovered after retry: ${aggregate.retryTotals.votesRecoveredAfterRetry}`,
    `- Confirmed by contract state: ${aggregate.retryTotals.confirmedByContractStateCount}`,
    `- Final reconciliation recovered: ${aggregate.retryTotals.recoveredByFinalReconciliationCount}`,
    `- Health wait seconds: ${aggregate.retryTotals.healthWaitSeconds}`,
    `- System unreachable approximation seconds: ${aggregate.retryTotals.systemUnreachableApproxSeconds}`,
    "",
    "RPC summary:",
    "",
    ...Object.entries(aggregate.rpcSummary || {}).map(([rpcUrl, summary]) => (
      `- ${rpcUrl}: rooms=${summary.runCount}, success=${summary.successCount}, failed=${summary.failedCount}, retries=${summary.totalSubmitRetries}, failedHealthProbes=${summary.failedHealthProbeCount}`
    )),
    "",
    "Generated files:",
    "",
    "- `summary-rooms.csv`",
    "- `summary-waves.csv`",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "summary.md"), `${markdown}\n`);
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
    rpcUrls: parseRpcUrls(),
    preflightRpcHealthEnabled: (process.env.STRESS_PREFLIGHT_RPC_HEALTH_ENABLED || configInput.preflightRpcHealthEnabled || "true").toString().toLowerCase() !== "false",
    preflightRpcHealthRequireAll: (process.env.STRESS_PREFLIGHT_RPC_HEALTH_REQUIRE_ALL || configInput.preflightRpcHealthRequireAll || "true").toString().toLowerCase() !== "false",
    preflightRpcHealthTimeoutMs: Number(process.env.STRESS_PREFLIGHT_RPC_HEALTH_TIMEOUT_MS || configInput.preflightRpcHealthTimeoutMs || 30000),
    preflightRpcHealthIntervalMs: Number(process.env.STRESS_PREFLIGHT_RPC_HEALTH_INTERVAL_MS || configInput.preflightRpcHealthIntervalMs || 1000),
  };
  config.requiredUniqueEoaPerWave = config.parallelRooms * config.votersPerRoom;

  const accountPayload = readJson(ACCOUNTS_PATH);
  const accounts = accountPayload.accounts || [];
  if (accounts.length < config.requiredUniqueEoaPerWave) {
    throw new Error(
      `Staggered parallel test needs at least ${config.requiredUniqueEoaPerWave} EOA accounts for ${config.parallelRooms} parallel rooms x ${config.votersPerRoom} voters. Found ${accounts.length}. Run: $env:ACCOUNT_COUNT="${config.requiredUniqueEoaPerWave}"; npm run generate:eoa`
    );
  }

  await fundAccountsIfNeeded(accounts, config.requiredUniqueEoaPerWave, process.env.FUND_AMOUNT || "1", config.rpcUrls);

  const startedAtMs = Date.now();
  const runDir = createRunResultDir(config.stageId);
  const storageBefore = snapshotNodeStorage();
  const rpcHealthBefore = await snapshotRpcHealth(config.rpcUrls);
  const waves = [];
  const totalWaves = Math.ceil(config.totalTps / config.parallelRooms);
  let runNumber = 1;
  let currentWaveDelayMs = config.waveDelayMs;

  logStep(`Starting ${config.stageName}`);
  logStep(`Result folder: ${displayPath(runDir)}`);
  logStep(`Target: ${config.totalTps} TPS rooms, ${config.parallelRooms} rooms parallel per wave, ${config.votersPerRoom} vote concurrent per room`);
  logStep(`Required unique EOA per wave: ${config.requiredUniqueEoaPerWave}. Reused only after each wave completes.`);
  logStep(`RPC endpoints: ${config.rpcUrls.join(", ")}`);

  for (let waveNumber = 1; waveNumber <= totalWaves; waveNumber++) {
    const waveTasks = [];
    let preflightRpcHealth = null;
    for (let slotNumber = 1; slotNumber <= config.parallelRooms && runNumber <= config.totalTps; slotNumber++) {
      const rpcIndex = (runNumber - 1) % config.rpcUrls.length;
      const rpcUrl = config.rpcUrls[rpcIndex];
      waveTasks.push({
        runNumber,
        waveNumber,
        slotNumber,
        accountOffset: (slotNumber - 1) * config.votersPerRoom,
        rpcUrl,
        rpcLabel: `rpc-${rpcIndex + 1}`,
      });
      runNumber += 1;
    }

    if (config.preflightRpcHealthEnabled) {
      const waveRpcUrls = [...new Set(waveTasks.map((task) => task.rpcUrl))];
      const preflight = await waitForRpcHealth(
        waveRpcUrls,
        `wave-${waveNumber}-preflight`,
        config.preflightRpcHealthTimeoutMs,
        config.preflightRpcHealthIntervalMs,
        config.preflightRpcHealthRequireAll
      );
      logStep(`Wave ${waveNumber} RPC preflight: ok=${preflight.ok}, healthy=${preflight.healthyCount}/${waveRpcUrls.length}, waited=${preflight.waitedMs}ms`);
      preflightRpcHealth = preflight;
    }

    const wave = await runWave(waveTasks, config, runDir);
    wave.preflightRpcHealth = preflightRpcHealth;
    wave.postWaveRpcHealth = await snapshotRpcHealth(config.rpcUrls);
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
  aggregate.storage = {
    before: storageBefore,
    after: snapshotNodeStorage(),
  };
  aggregate.rpcHealth = {
    endpoints: config.rpcUrls,
    before: rpcHealthBefore,
    after: await snapshotRpcHealth(config.rpcUrls),
  };
  aggregate.resultFolder = displayPath(runDir);
  const aggregatePath = path.join(runDir, `sampling-${config.stageId}-${Date.now()}.json`);
  writeJson(aggregatePath, aggregate);
  writeAggregateReports(aggregate, runDir);

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
    summaryMarkdown: displayPath(path.join(runDir, "summary.md")),
    summaryRoomsCsv: displayPath(path.join(runDir, "summary-rooms.csv")),
    summaryWavesCsv: displayPath(path.join(runDir, "summary-waves.csv")),
  }, null, 2));
}

module.exports = { runStaggeredParallelTpsStage };
