const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 3);

runSamplingStage({
  stageId: "stage-2-baseline",
  stageName: "Tahap 2 - Baseline",
  purpose: "Ambil pembanding latency normal dengan vote dikirim satu per satu.",
  populationTps: 30000,
  targetSampleTps: roomCount * 30,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "sequential",
  voteRunTimeoutMs: "180000",
});
