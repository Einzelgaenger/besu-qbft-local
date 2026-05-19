const { runSamplingStage } = require("./sampling-runner");

const batchIndex = Number(process.env.TPS_BATCH_INDEX || 1);
const roomCount = Number(process.env.SAMPLING_ROOM_COUNT || 30);
const paddedBatchIndex = String(batchIndex).padStart(2, "0");

runSamplingStage({
  stageId: `stage-3-tps-batch-${paddedBatchIndex}`,
  stageName: `Tahap 3 - TPS sampling batch ${paddedBatchIndex}`,
  purpose: "Batch TPS sampling: setiap TPS sample dibuat sebagai 1 room dengan 30 voter simulasi concurrent.",
  sampleUnit: "tps-room",
  populationTps: Number(process.env.POPULATION_TPS || 3000),
  targetSampleTps: roomCount,
  roomCount,
  eoaPerRoom: 30,
  voteMode: "concurrent",
  roomDelayMs: 5000,
});
