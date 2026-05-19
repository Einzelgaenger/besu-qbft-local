const { runSamplingStage } = require("./sampling-runner");

const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 13);

runSamplingStage({
  stageId: "stage-3-main-sampling",
  stageName: "Tahap 3 - Main sampling",
  purpose: "Sample utama transaksi vote: 390 vote dari 13 TPS simulasi dengan transaksi vote concurrent.",
  populationTps: Number(process.env.POPULATION_TPS || 3000),
  targetSampleTps: roomCount * 30,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "concurrent",
});
