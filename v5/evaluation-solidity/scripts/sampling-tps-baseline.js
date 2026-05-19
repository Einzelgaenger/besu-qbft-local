const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 3);

runSamplingStage({
  stageId: "stage-2-tps-baseline",
  stageName: "Tahap 2 - TPS baseline",
  purpose: "Ambil baseline dari 3 TPS sample: setiap TPS adalah 1 room dengan 30 voter simulasi sequential.",
  sampleUnit: "tps-room",
  populationTps: Number(process.env.POPULATION_TPS || 3000),
  targetSampleTps: roomCount,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "sequential",
  voteRunTimeoutMs: "180000",
});
