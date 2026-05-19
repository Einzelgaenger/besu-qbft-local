const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 1);

runSamplingStage({
  stageId: "stage-1-tps-smoke",
  stageName: "Tahap 1 - TPS smoke test",
  purpose: "Pastikan 1 TPS sample dapat dibuat sebagai 1 room, lalu 30 voter simulasi dapat vote secara sequential.",
  sampleUnit: "tps-room",
  populationTps: Number(process.env.POPULATION_TPS || 3000),
  targetSampleTps: roomCount,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "sequential",
  voteRunTimeoutMs: "180000",
});
