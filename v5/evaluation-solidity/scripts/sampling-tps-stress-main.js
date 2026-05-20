const { runStaggeredParallelTpsStage } = require("./sampling-tps-stress-runner");

runStaggeredParallelTpsStage({
  stageId: "stage-5-tps-stress-main",
  stageName: "Tahap 5 - TPS staggered parallel stress main",
  purpose: "Stress test utama: 390 TPS room diproses dalam wave parallel kecil. Tiap room mengirim 30 vote concurrent.",
  totalTps: 390,
  parallelRooms: 5,
  votersPerRoom: 30,
  staggerWindowMs: 5000,
  waveDelayMs: 10000,
});
