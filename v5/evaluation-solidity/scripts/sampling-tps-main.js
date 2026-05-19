const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 390);

runSamplingStage({
  stageId: "stage-3-tps-main-sampling",
  stageName: "Tahap 3 - TPS main sampling",
  purpose: "Sample utama TPS: 390 TPS sample dari populasi TPS Jakarta. Setiap TPS direpresentasikan sebagai 1 room dengan 30 voter simulasi concurrent.",
  sampleUnit: "tps-room",
  populationTps: Number(process.env.POPULATION_TPS || 3000),
  targetSampleTps: roomCount,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "concurrent",
  roomDelayMs: 5000,
});
