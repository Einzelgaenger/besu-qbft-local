const { runStaggeredParallelTpsStage } = require("./sampling-tps-stress-runner");

const batchIndex = Number(process.env.TPS_BATCH_INDEX || 1);
const paddedBatchIndex = String(batchIndex).padStart(2, "0");

runStaggeredParallelTpsStage({
  stageId: `stage-5-tps-stress-batch-${paddedBatchIndex}`,
  stageName: `Tahap 5 - TPS staggered parallel stress batch ${paddedBatchIndex}`,
  purpose: "Stress test batch: beberapa TPS room berjalan parallel, dan tiap TPS room mengirim 30 vote concurrent.",
  totalTps: 30,
  parallelRooms: 5,
  votersPerRoom: 30,
  staggerWindowMs: 5000,
  waveDelayMs: 10000,
});
