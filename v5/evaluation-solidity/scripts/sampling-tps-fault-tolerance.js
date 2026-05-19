const {
  ROOT,
  logStep,
  runCommand,
  runSamplingStage,
  sleepSync,
} = require("./sampling-runner");

const DOCKER = process.platform === "win32" ? "docker.exe" : "docker";
const nodeContainer = process.env.FAULT_NODE_CONTAINER || "besu-v5-node4";
const waitSeconds = Number(process.env.FAULT_WAIT_SECONDS || 10);
const skipDockerStop = process.env.FAULT_SKIP_DOCKER_STOP === "true";
const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 2);
let stoppedByScript = false;

try {
  if (skipDockerStop) {
    logStep(`Skipping docker stop. Pastikan ${nodeContainer} sudah dimatikan manual sebelum script ini lanjut.`);
  } else {
    logStep(`Stopping ${nodeContainer} for TPS fault tolerance test...`);
    runCommand(DOCKER, ["stop", nodeContainer], { cwd: ROOT });
    stoppedByScript = true;
    logStep(`Waiting ${waitSeconds} seconds after stopping ${nodeContainer}...`);
    sleepSync(waitSeconds * 1000);
  }

  runSamplingStage({
    stageId: "stage-4-tps-fault-tolerance",
    stageName: "Tahap 4 - TPS fault tolerance",
    purpose: "Uji apakah jaringan 4-node QBFT tetap memproses TPS room concurrent saat 1 node mati.",
    sampleUnit: "tps-room",
    populationTps: Number(process.env.POPULATION_TPS || 3000),
    targetSampleTps: roomCount,
    roomCount,
    eoaPerRoom: 30,
    voteMode: "concurrent",
    faultTolerance: {
      scenario: "1 Besu node stopped before running TPS room tests.",
      stoppedNodeContainer: nodeContainer,
      skipDockerStop,
    },
  });
} finally {
  if (stoppedByScript) {
    logStep(`Starting ${nodeContainer} again...`);
    runCommand(DOCKER, ["start", nodeContainer], { cwd: ROOT });
  }
}
