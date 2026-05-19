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
    logStep(`Stopping ${nodeContainer} for fault tolerance test...`);
    runCommand(DOCKER, ["stop", nodeContainer], { cwd: ROOT });
    stoppedByScript = true;
    logStep(`Waiting ${waitSeconds} seconds after stopping ${nodeContainer}...`);
    sleepSync(waitSeconds * 1000);
  }

  runSamplingStage({
    stageId: "stage-4-fault-tolerance",
    stageName: "Tahap 4 - Fault tolerance",
    purpose: "Uji apakah jaringan 4-node QBFT tetap memproses vote concurrent saat 1 node mati.",
    populationTps: 30000,
    targetSampleTps: roomCount * 30,
    roomCount,
    eoaPerRoom: 30,
    voteMode: "concurrent",
    faultTolerance: {
      scenario: "1 Besu node stopped before running vote tests.",
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
