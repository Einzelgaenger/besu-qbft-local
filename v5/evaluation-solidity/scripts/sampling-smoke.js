const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 1);

runSamplingStage({
  stageId: "stage-1-smoke",
  stageName: "Tahap 1 - Smoke test",
  purpose: "Pastikan flow room, voter, candidate, start, vote, stop, dan inspect berjalan benar.",
  populationTps: 30000,
  targetSampleTps: roomCount * 30,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "sequential",
  voteRunTimeoutMs: "180000",
});
