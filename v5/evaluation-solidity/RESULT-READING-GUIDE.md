# Result Reading Guide

Dokumen ini menjelaskan cara membaca hasil testing sampling pada folder `evaluation-solidity/results`.

Catatan istilah:

```text
TPS  = Tempat Pemungutan Suara
tx/s = transaction per second
```

Di project ini, jangan memakai istilah `TPS` untuk transaction per second karena bisa rancu dengan Tempat Pemungutan Suara. Untuk performa transaksi, gunakan istilah `tx/s` atau `transaction throughput`.

## Struktur Output Result

Setiap testing membuat satu folder di:

```text
evaluation-solidity/results/
```

Format nama folder:

```text
[nama-testing]-[YYYYMMDD-HHmmss]
```

Contoh:

```text
results/stage-5-tps-stress-main-20260524-170439/
```

Isi folder stress test biasanya:

```text
sampling-stage-*.json
summary.md
summary-rooms.csv
summary-waves.csv
room-vote-*.json
```

Makna tiap file:

| File | Isi | Dipakai untuk |
|---|---|---|
| `sampling-stage-*.json` | Aggregate result seluruh testing | Sumber data paling lengkap |
| `summary.md` | Ringkasan hasil utama | Cepat membaca hasil akhir |
| `summary-rooms.csv` | Satu baris per room/TPS | Analisis per TPS room di Excel |
| `summary-waves.csv` | Satu baris per wave/batch | Analisis per batch parallel di Excel |
| `room-vote-*.json` | Detail satu room/TPS | Audit detail voter, tx hash, retry, gas, latency |

## Waktu dan Timestamp

Ada dua jenis timestamp:

```text
Folder result:
Mengikuti waktu lokal komputer saat folder dibuat.

Field JSON seperti startedAt, finishedAt, measuredAt, deployedAt:
Format ISO dengan akhiran Z, artinya UTC.
```

Contoh:

```text
"measuredAt": "2026-05-24T10:04:28.211Z"
```

Huruf `Z` berarti UTC. Jika ingin dikonversi ke WIB, tambahkan 7 jam.

## Model Data Testing

Mapping yang dipakai:

```text
1 TPS simulasi = 1 VotingRoom / room
1 EOA = 1 voter simulasi
1 vote transaction = 1 suara dari voter di room tersebut
1 wave = batch beberapa room yang berjalan parallel
```

Contoh stress balanced:

```text
390 TPS room
2 room parallel per wave
30 vote concurrent per room
195 wave
11.700 vote transaction
```

Rumus:

```text
expectedVoteTransactions = tpsRoomCount x votersPerRoom
```

Contoh:

```text
390 x 30 = 11.700 vote transaction
```

## Cara Cepat Membaca `summary.md`

`summary.md` adalah file paling cepat untuk melihat apakah testing berhasil.

Contoh field:

```text
TPS rooms: 390
Parallel rooms per wave: 2
Expected vote transactions: 11700
Success count: 11700 (100.00%)
Failed vote count: 0
On-chain votes: 11700 (100.00%)
Event count: 11700
Elapsed: 6788766 ms
Avg successful attempt latency: 1561.32 ms
Avg total vote elapsed: 2038.62 ms
Total submit retries: 0
Average submit retries per vote: 0
Confirmed by contract state: 23
Health wait seconds: 46.661
```

Cara baca:

| Field | Arti |
|---|---|
| `TPS rooms` | Jumlah TPS simulasi atau jumlah room |
| `Parallel rooms per wave` | Berapa room berjalan bersamaan dalam satu wave |
| `Expected vote transactions` | Target vote transaction |
| `Success count` | Jumlah vote yang dianggap sukses oleh script |
| `Failed vote count` | Jumlah vote yang gagal |
| `On-chain votes` | Vote yang benar-benar tercatat di smart contract |
| `Event count` | Jumlah event `VoteCast` yang ditemukan |
| `Elapsed` | Durasi testing dari awal command sampai selesai |
| `Avg successful attempt latency` | Rata-rata waktu dari tx hash diterima sampai receipt confirm |
| `Avg total vote elapsed` | Rata-rata waktu dari attempt pertama sampai hasil akhir vote |
| `Total submit retries` | Total retry submit vote |
| `Confirmed by contract state` | Vote yang response submit/receipt-nya bermasalah, tetapi contract membuktikan voter sudah vote |
| `Health wait seconds` | Total waktu tunggu health-check sebelum retry |

Kondisi ideal:

```text
Success count = Expected vote transactions
Failed vote count = 0
On-chain votes = Expected vote transactions
Event count = Expected vote transactions
```

Jika semua sama, berarti hasil voting lengkap dan terverifikasi on-chain.

## Cara Membaca Aggregate JSON

File:

```text
sampling-stage-*.json
```

Ini adalah file utama untuk analisis penelitian. Struktur besarnya:

```text
metadata testing
totals
retryTotals
rpcSummary
averages
waves
storage
rpcHealth
```

### Metadata Testing

Field penting:

| Field | Arti |
|---|---|
| `stageId` | ID testing |
| `stageName` | Nama testing |
| `sampleUnit` | Unit sample, misalnya `tps-room` |
| `testType` | Bentuk test, misalnya `staggered-parallel-tps` |
| `populationTps` | Populasi TPS acuan |
| `targetSampleTps` | Jumlah TPS room yang diuji |
| `parallelRooms` | Jumlah room parallel per wave |
| `votersPerRoom` | Jumlah voter per room |
| `expectedVoteTransactions` | Target vote transaction |
| `voteMode` | Mode voting, biasanya `concurrent` |
| `staggerWindowMs` | Jendela random delay launch room dalam satu wave |
| `waveDelayMs` | Base delay antar-wave |
| `startedAt` | Waktu mulai testing UTC |
| `finishedAt` | Waktu selesai testing UTC |
| `elapsedMs` | Durasi total testing dalam millisecond |

### `totals`

Field:

```text
totals.successCount
totals.failedVoteCount
totals.failedProcessRoomCount
totals.totalVotesOnChain
totals.eventCount
totals.totalGasUsed
totals.timeoutRunCount
```

Cara baca:

| Field | Arti |
|---|---|
| `successCount` | Total vote sukses menurut script |
| `failedVoteCount` | Total vote gagal |
| `failedProcessRoomCount` | Jumlah room process yang crash/exit non-zero |
| `totalVotesOnChain` | Total vote dari smart contract |
| `eventCount` | Total event `VoteCast` |
| `totalGasUsed` | Total gas vote transaction |
| `timeoutRunCount` | Jumlah room yang kena timeout |

Interpretasi:

```text
failedVoteCount > 0
Berarti ada vote yang tidak berhasil setelah retry/recovery.

failedProcessRoomCount > 0
Berarti ada child process room test yang crash atau exit error.

timeoutRunCount > 0
Berarti ada room yang melewati batas waktu vote run.

totalVotesOnChain < expectedVoteTransactions
Berarti ada vote yang belum tercatat on-chain.

eventCount < expectedVoteTransactions
Berarti event VoteCast yang terbaca kurang dari target.
```

Jika `totalVotesOnChain` atau `eventCount` bernilai `null`, biasanya inspect event/on-chain gagal, misalnya karena batas range RPC. Untuk data final thesis, sebaiknya hasil on-chain tidak `null`.

### `averages`

Field:

```text
averages.avgLatencyMs
averages.avgSuccessfulAttemptLatencyMs
averages.avgTotalVoteElapsedMs
averages.avgRetryRecoveryElapsedMs
averages.avgGasUsed
```

Cara baca:

| Field | Arti |
|---|---|
| `avgLatencyMs` | Alias/backward-compatible untuk latency vote sukses |
| `avgSuccessfulAttemptLatencyMs` | Waktu dari tx hash diterima sampai receipt confirm pada attempt yang sukses |
| `avgTotalVoteElapsedMs` | Waktu dari attempt pertama sampai hasil akhir vote |
| `avgRetryRecoveryElapsedMs` | Waktu sejak retry pertama sampai vote berhasil |
| `avgGasUsed` | Rata-rata gas per vote transaction |

Perbedaan penting:

```text
avgSuccessfulAttemptLatencyMs
Mengukur performa transaksi yang akhirnya berhasil.

avgTotalVoteElapsedMs
Mengukur pengalaman end-to-end vote, termasuk submit delay, retry, dan recovery.

avgRetryRecoveryElapsedMs
Hanya relevan untuk vote yang mengalami retry.
```

Jika tidak ada retry, `avgRetryRecoveryElapsedMs` bisa `null`.

### `retryTotals`

Field:

```text
retryTotals.totalSubmitAttempts
retryTotals.totalSubmitRetries
retryTotals.votesWithRetry
retryTotals.votesRecoveredAfterRetry
retryTotals.failedAfterRetries
retryTotals.confirmedByContractStateCount
retryTotals.recoveredByFinalReconciliationCount
retryTotals.revertedButAlreadyVotedCount
retryTotals.retryRecoveryCount
retryTotals.totalRetryRecoveryElapsedMs
retryTotals.maxRetryRecoveryElapsedMs
retryTotals.maxSubmitAttemptsPerVote
retryTotals.maxSubmitRetriesPerVote
retryTotals.healthCheckCount
retryTotals.failedHealthProbeCount
retryTotals.healthWaitMs
retryTotals.systemUnreachableApproxMs
retryTotals.submitAttemptDistribution
retryTotals.submitRetryDistribution
retryTotals.failureReasonCounts
retryTotals.averageSubmitAttemptsPerVote
retryTotals.averageSubmitRetriesPerVote
retryTotals.averageRetryRecoveryElapsedMs
retryTotals.healthWaitSeconds
retryTotals.systemUnreachableApproxSeconds
```

Cara baca:

| Field | Arti |
|---|---|
| `totalSubmitAttempts` | Total semua attempt submit vote |
| `totalSubmitRetries` | Total retry, tidak termasuk attempt pertama |
| `votesWithRetry` | Jumlah vote yang butuh retry |
| `votesRecoveredAfterRetry` | Vote yang sempat gagal tetapi sukses setelah retry |
| `failedAfterRetries` | Vote yang tetap gagal setelah retry |
| `confirmedByContractStateCount` | Vote yang dikonfirmasi sukses dari state contract |
| `recoveredByFinalReconciliationCount` | Failed row yang dipulihkan saat pengecekan akhir |
| `retryRecoveryCount` | Jumlah vote yang punya durasi recovery |
| `maxSubmitRetriesPerVote` | Retry terbanyak pada satu vote |
| `healthCheckCount` | Jumlah health-check yang dilakukan |
| `failedHealthProbeCount` | Jumlah probe RPC yang gagal |
| `healthWaitSeconds` | Total waktu menunggu RPC sehat |
| `systemUnreachableApproxSeconds` | Estimasi waktu RPC tidak reachable |
| `failureReasonCounts` | Ringkasan alasan gagal |

Contoh:

```json
"failureReasonCounts": {
  "other side closed": 90
}
```

Artinya ada 90 kejadian koneksi RPC tertutup saat submit/confirm. Jika `votesRecoveredAfterRetry` juga 90 dan `failedAfterRetries` 0, berarti semua masalah tersebut berhasil dipulihkan.

Distribusi attempt:

```json
"submitAttemptDistribution": {
  "1": 660,
  "2": 90
}
```

Artinya:

```text
660 vote sukses pada attempt pertama
90 vote butuh 2 attempt
```

Distribusi retry:

```json
"submitRetryDistribution": {
  "0": 660,
  "1": 90
}
```

Artinya:

```text
660 vote tanpa retry
90 vote retry 1 kali
```

### `rpcSummary`

Contoh:

```json
"http://127.0.0.1:8545": {
  "runCount": 98,
  "successCount": 2940,
  "failedCount": 0,
  "totalVotesOnChain": 2940,
  "totalSubmitRetries": 0,
  "failedHealthProbeCount": 0
}
```

Cara baca:

| Field | Arti |
|---|---|
| `runCount` | Jumlah room yang memakai RPC tersebut |
| `successCount` | Vote sukses lewat room yang memakai RPC tersebut |
| `failedCount` | Vote gagal lewat room yang memakai RPC tersebut |
| `totalVotesOnChain` | Vote on-chain dari room di RPC tersebut |
| `totalSubmitRetries` | Retry yang terjadi pada RPC tersebut |
| `failedHealthProbeCount` | Health probe gagal pada RPC tersebut |

Jika retry banyak hanya di satu RPC, indikasinya endpoint RPC tersebut lebih berat atau koneksinya lebih sering tertutup.

### `waves`

`waves` adalah array batch. Satu wave berisi beberapa room yang berjalan parallel.

Field penting:

| Field | Arti |
|---|---|
| `waveNumber` | Nomor wave |
| `startedAt` | Waktu mulai wave UTC |
| `finishedAt` | Waktu selesai wave UTC |
| `elapsedMs` | Durasi wave aktif, tidak termasuk delay setelah wave |
| `launchDelays` | Random delay launch room dalam wave |
| `runs` | Daftar room yang berjalan dalam wave |
| `preflightRpcHealth` | Health-check RPC sebelum wave |
| `postWaveRpcHealth` | Health-check RPC setelah wave |
| `nextWaveDelay` | Keputusan delay menuju wave berikutnya |

### `waves[].runs[]`

Satu `run` adalah satu room/TPS.

Field penting:

| Field | Arti |
|---|---|
| `ok` | Process room sukses atau tidak |
| `runNumber` | Nomor room dalam testing |
| `waveNumber` | Room ini masuk wave berapa |
| `slotNumber` | Slot parallel dalam wave |
| `resultPath` | Path room detail JSON |
| `room` | Address smart contract room |
| `roomName` | Nama room |
| `rpcUrl` | RPC endpoint yang dipakai room |
| `accountOffset` | Offset EOA yang dipakai |
| `voterCount` | Jumlah voter dalam room |
| `successCount` | Vote sukses di room |
| `failedCount` | Vote gagal di room |
| `timeoutExceeded` | Apakah room kena timeout |
| `elapsedMs` | Durasi vote run pada room |
| `avgSuccessfulAttemptLatencyMs` | Rata-rata latency attempt sukses |
| `avgTotalVoteElapsedMs` | Rata-rata elapsed total vote |
| `avgRetryRecoveryElapsedMs` | Rata-rata recovery jika ada retry |
| `latencyPercentiles` | Percentile latency attempt sukses |
| `totalVoteElapsedPercentiles` | Percentile elapsed total |
| `retryRecoveryElapsedPercentiles` | Percentile recovery |
| `totalGasUsed` | Total gas vote di room |
| `avgGasUsed` | Rata-rata gas vote |
| `totalVotesOnChain` | Vote on-chain di room |
| `eventCount` | Event VoteCast di room |
| `retrySummary` | Summary retry untuk room |

## Cara Membaca Room Detail JSON

File:

```text
room-vote-*.json
```

File ini dipakai jika ingin audit detail satu TPS room.

Bagian penting:

```text
room
roomName
rpcUrl
admin
system
prepare
start
voteRun
stop
inspect
finalReconciliation
measuredAt
```

### `voteRun.rows[]`

Ini bagian paling detail. Satu row = satu voter/vote.

Field yang sering dipakai:

| Field | Arti |
|---|---|
| `index` | Urutan voter |
| `voter` | Address EOA voter |
| `candidateId` | Candidate yang dipilih |
| `ok` | Vote sukses atau tidak |
| `status` | Status receipt, `1` sukses |
| `txHash` | Hash transaksi vote |
| `blockNumber` | Block tempat transaksi masuk |
| `gasUsed` | Gas untuk vote |
| `submitAttempts` | Jumlah attempt submit |
| `retryCount` | Jumlah retry |
| `failureReasons` | Daftar alasan gagal sebelum sukses |
| `attempts[]` | Detail tiap attempt |
| `confirmedByContractState` | Vote dianggap sukses karena contract state membuktikan sudah vote |
| `latencyMs` | Latency vote sukses |
| `successfulAttemptLatencyMs` | Latency attempt yang sukses |
| `successfulAttemptSubmitElapsedMs` | Waktu submit request sampai tx hash didapat |
| `totalVoteElapsedMs` | Waktu dari attempt pertama sampai selesai |
| `retryRecoveryElapsedMs` | Waktu dari retry pertama sampai selesai |
| `healthChecks[]` | Detail health-check sebelum retry |

Cara sistem tahu voter sudah vote:

```text
lastVotedRound[voter] == currentRound
```

Jika submit response hilang atau RPC bermasalah, script mengecek state contract. Jika `lastVotedRound` menunjukkan voter sudah vote di round tersebut, vote dapat ditandai sukses walaupun response RPC sebelumnya bermasalah.

### `inspect`

Bagian `inspect` membaca hasil on-chain:

```text
inspect.totalVotes
inspect.eventCount
inspect.candidates[]
```

Cara baca:

| Field | Arti |
|---|---|
| `totalVotes` | Total vote yang tersimpan di contract untuk round tersebut |
| `eventCount` | Jumlah event `VoteCast` |
| `candidates[]` | Perolehan vote per candidate |

Jika `inspect.totalVotes` sama dengan `successCount`, berarti hasil vote di script cocok dengan hasil smart contract.

## Cara Membaca `summary-rooms.csv`

File:

```text
summary-rooms.csv
```

Satu baris = satu room/TPS.

Header saat ini:

```text
waveNumber
runNumber
ok
roomName
rpcUrl
successCount
failedCount
totalVotesOnChain
eventCount
avgSuccessfulAttemptLatencyMs
avgTotalVoteElapsedMs
avgRetryRecoveryElapsedMs
retryRecoveryCount
totalSubmitRetries
averageSubmitRetriesPerVote
maxSubmitRetriesPerVote
votesRecoveredAfterRetry
confirmedByContractStateCount
recoveredByFinalReconciliationCount
failedHealthProbeCount
healthWaitSeconds
systemUnreachableApproxSeconds
timeoutExceeded
exitCode
error
resultPath
```

Kolom penting:

| Kolom | Arti |
|---|---|
| `waveNumber` | Room ini berjalan di wave berapa |
| `runNumber` | Nomor room/TPS |
| `ok` | Process room berhasil |
| `roomName` | Nama room |
| `rpcUrl` | RPC endpoint yang dipakai |
| `successCount` | Vote sukses di room |
| `failedCount` | Vote gagal di room |
| `totalVotesOnChain` | Vote yang tercatat on-chain |
| `eventCount` | Event VoteCast |
| `avgSuccessfulAttemptLatencyMs` | Rata-rata latency attempt sukses |
| `avgTotalVoteElapsedMs` | Rata-rata elapsed end-to-end vote |
| `avgRetryRecoveryElapsedMs` | Rata-rata durasi recovery retry |
| `totalSubmitRetries` | Total retry pada room |
| `failedHealthProbeCount` | Jumlah health probe gagal pada room |
| `healthWaitSeconds` | Total waktu tunggu health check |
| `timeoutExceeded` | Apakah room kena timeout |
| `exitCode` | Exit code jika process gagal |
| `error` | Error jika ada |
| `resultPath` | Link/path room detail JSON |

Kegunaan di Excel:

```text
1. Filter failedCount > 0
   Untuk mencari room yang ada vote gagal.

2. Filter totalSubmitRetries > 0
   Untuk mencari room yang mengalami retry.

3. Filter failedHealthProbeCount > 0
   Untuk mencari room yang sempat menunggu RPC sehat.

4. Sort avgTotalVoteElapsedMs descending
   Untuk mencari room paling lambat.

5. Group by rpcUrl
   Untuk melihat RPC mana yang paling banyak retry atau lambat.
```

Formula Excel yang berguna:

```text
Retry rate per room:
=N2/F2
```

Dengan header saat ini:

```text
N = totalSubmitRetries
F = successCount
```

```text
On-chain completeness:
=H2/F2
```

Dengan header saat ini:

```text
H = totalVotesOnChain
F = successCount
```

```text
Successful latency in seconds:
=J2/1000
```

Dengan header saat ini:

```text
J = avgSuccessfulAttemptLatencyMs
```

Catatan: `summary-rooms.csv` saat ini tidak memiliki kolom `elapsedMs`, jadi room-level tx/s paling akurat dihitung dari aggregate JSON `waves[].runs[].elapsedMs` atau dari `room-vote-*.json`.

## Cara Membaca `summary-waves.csv`

File:

```text
summary-waves.csv
```

Satu baris = satu wave/batch.

Header saat ini:

```text
waveNumber
runCount
elapsedMs
successCount
failedCount
totalVotesOnChain
totalSubmitRetries
failedHealthProbeCount
healthWaitSeconds
nextWaveDelayMs
delayReasons
```

Kolom penting:

| Kolom | Arti |
|---|---|
| `waveNumber` | Nomor wave |
| `runCount` | Jumlah room dalam wave |
| `elapsedMs` | Durasi wave aktif |
| `successCount` | Vote sukses dalam wave |
| `failedCount` | Vote gagal dalam wave |
| `totalVotesOnChain` | Vote on-chain dalam wave |
| `totalSubmitRetries` | Total retry dalam wave |
| `failedHealthProbeCount` | Health probe gagal dalam wave |
| `healthWaitSeconds` | Waktu tunggu health check dalam wave |
| `nextWaveDelayMs` | Delay menuju wave berikutnya |
| `delayReasons` | Alasan dynamic delay naik/turun |

Kegunaan di Excel:

```text
1. Sort totalSubmitRetries descending
   Untuk mencari wave yang paling berat.

2. Sort failedHealthProbeCount descending
   Untuk mencari wave yang RPC-nya paling bermasalah.

3. Sort elapsedMs descending
   Untuk mencari wave yang paling lambat.

4. Lihat delayReasons
   Untuk melihat kenapa script menambah/mengurangi delay.
```

Formula Excel:

```text
Wave tx/s:
=D2/(C2/1000)
```

Dengan header saat ini:

```text
D = successCount
C = elapsedMs
```

```text
Wave retry rate:
=G2/D2
```

Dengan header saat ini:

```text
G = totalSubmitRetries
D = successCount
```

```text
Wave on-chain completeness:
=F2/D2
```

Dengan header saat ini:

```text
F = totalVotesOnChain
D = successCount
```

## Menghitung Transaction Throughput / tx/s

Ada tiga level throughput yang sebaiknya dibedakan.

### 1. Sampling-level tx/s

Mengukur durasi end-to-end seluruh eksperimen.

Rumus:

```text
sampling tx/s = totals.successCount / (elapsedMs / 1000)
```

Makna:

```text
Ini menghitung semua waktu dari awal command sampai selesai,
termasuk delay antar-wave, setup room, recovery, dan health wait.
```

Kapan dipakai:

```text
Untuk melaporkan durasi total eksperimen dan throughput end-to-end.
```

### 2. Active wave tx/s

Mengukur throughput saat wave sedang berjalan, tanpa menghitung delay antar-wave.

Rumus:

```text
active wave tx/s = SUM(waves.successCount) / (SUM(waves.elapsedMs) / 1000)
```

Jika menggunakan `summary-waves.csv` di Excel:

```text
=SUM(D:D)/(SUM(C:C)/1000)
```

Dengan header:

```text
D = successCount
C = elapsedMs
```

Makna:

```text
Ini lebih dekat ke performa aktif jaringan saat batch transaksi sedang diproses.
```

### 3. Wave-level tx/s

Mengukur throughput per batch.

Rumus:

```text
wave tx/s = wave.successCount / (wave.elapsedMs / 1000)
```

Jika menggunakan Excel:

```text
=D2/(C2/1000)
```

Makna:

```text
Dipakai untuk melihat wave mana yang cepat, lambat, atau banyak retry.
```

### 4. Room-level tx/s

Mengukur throughput vote dalam satu room/TPS.

Rumus dari aggregate JSON:

```text
room tx/s = waves[].runs[].successCount / (waves[].runs[].elapsedMs / 1000)
```

Makna:

```text
Ini melihat seberapa cepat 30 vote dalam satu room selesai.
```

Catatan:

```text
summary-rooms.csv saat ini belum menyimpan elapsedMs,
jadi room tx/s tidak bisa dihitung langsung dari CSV tersebut tanpa mengambil data dari JSON.
```

## Contoh Interpretasi Hasil

Contoh hasil:

```text
Expected vote transactions: 11700
Success count: 11700
Failed vote count: 0
On-chain votes: 11700
Event count: 11700
Total submit retries: 0
Confirmed by contract state: 23
Health wait seconds: 46.661
```

Interpretasi:

```text
Semua vote berhasil dan seluruhnya tercatat on-chain.
Tidak ada failed vote.
Tidak ada retry submit.
Ada 23 vote yang sempat tidak mendapat response normal,
tetapi contract state membuktikan voter tersebut sudah vote.
Ada waktu tunggu health-check sekitar 46,661 detik,
tetapi tidak menyebabkan vote gagal.
```

Narasi singkat:

```text
Pengujian berhasil memproses 11.700 transaksi vote dari 390 TPS room dengan tingkat keberhasilan 100%.
Seluruh vote terverifikasi on-chain melalui totalVotes dan event VoteCast.
Meskipun terdapat indikasi gangguan response RPC pada sebagian kecil vote, mekanisme verifikasi contract state memastikan tidak ada kehilangan suara.
```

## Red Flags Saat Membaca Result

Perhatikan kondisi berikut:

| Kondisi | Makna |
|---|---|
| `failedVoteCount > 0` | Ada vote gagal |
| `failedProcessRoomCount > 0` | Ada room process crash |
| `timeoutRunCount > 0` | Ada room melewati timeout |
| `totalVotesOnChain < successCount` | Sebagian vote sukses script belum terbukti on-chain |
| `eventCount < totalVotesOnChain` | Event tidak terbaca lengkap |
| `totalSubmitRetries` tinggi | RPC/load mulai berat |
| `failedHealthProbeCount` tinggi | RPC sering tidak sehat |
| `systemUnreachableApproxSeconds` tinggi | Estimasi koneksi RPC bermasalah |
| `avgTotalVoteElapsedMs` jauh lebih tinggi dari `avgSuccessfulAttemptLatencyMs` | Banyak retry, submit delay, atau health wait |
| `failedAfterRetries > 0` | Retry tidak cukup untuk memulihkan semua vote |

## Kapan Result Layak Dipakai untuk Thesis

Hasil layak dipakai sebagai data utama jika:

```text
successCount == expectedVoteTransactions
failedVoteCount == 0
totalVotesOnChain == expectedVoteTransactions
eventCount == expectedVoteTransactions
failedProcessRoomCount == 0
timeoutRunCount == 0
```

Retry masih boleh ada jika:

```text
failedAfterRetries == 0
votesRecoveredAfterRetry == votesWithRetry
totalVotesOnChain tetap lengkap
```

Dalam narasi thesis, retry tidak harus dianggap kegagalan sistem voting. Retry dapat dijelaskan sebagai:

```text
indikasi bottleneck RPC/load generator pada environment lokal,
tetapi reliability tetap terjaga karena transaksi akhirnya tercatat on-chain.
```

## Cara Membuat Tabel Analisis di Excel

### Untuk `summary-rooms.csv`

Langkah:

```text
1. Buka Excel.
2. Data -> From Text/CSV.
3. Pilih summary-rooms.csv.
4. Pastikan delimiter comma.
5. Load.
6. Buat filter pada header.
```

Kolom yang sebaiknya dicek:

```text
failedCount
totalSubmitRetries
failedHealthProbeCount
healthWaitSeconds
avgSuccessfulAttemptLatencyMs
avgTotalVoteElapsedMs
rpcUrl
```

Analisis yang bisa dibuat:

```text
Rata-rata latency per RPC:
Pivot table -> Rows: rpcUrl -> Values: average avgTotalVoteElapsedMs

Total retry per RPC:
Pivot table -> Rows: rpcUrl -> Values: sum totalSubmitRetries

Room paling lambat:
Sort avgTotalVoteElapsedMs descending

Room dengan retry:
Filter totalSubmitRetries > 0
```

### Untuk `summary-waves.csv`

Tambahkan kolom baru:

```text
waveTxPerSecond
```

Formula:

```text
=D2/(C2/1000)
```

Tambahkan kolom:

```text
retryRate
```

Formula:

```text
=G2/D2
```

Tambahkan kolom:

```text
onChainCompleteness
```

Formula:

```text
=F2/D2
```

Analisis yang bisa dibuat:

```text
Wave tx/s rata-rata
Wave tx/s minimum dan maksimum
Wave dengan retry terbanyak
Wave dengan health wait tertinggi
Hubungan retry dengan dynamic delay
```

## PowerShell Cepat untuk Hitung tx/s

Dari folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
```

Sampling-level tx/s:

```powershell
$p = ".\evaluation-solidity\results\stage-5-tps-stress-main-20260524-170439\sampling-stage-5-tps-stress-main-1779623868211.json"
$j = Get-Content $p -Raw | ConvertFrom-Json
"sampling tx/s = {0:N3}" -f ($j.totals.successCount / ($j.elapsedMs / 1000))
```

Active wave tx/s:

```powershell
$activeMs = ($j.waves | Measure-Object -Property elapsedMs -Sum).Sum
"active wave tx/s = {0:N3}" -f ($j.totals.successCount / ($activeMs / 1000))
```

Wave-level tx/s:

```powershell
$j.waves | ForEach-Object {
  $success = ($_.runs | Measure-Object -Property successCount -Sum).Sum
  [pscustomobject]@{
    wave = $_.waveNumber
    success = $success
    elapsedSec = $_.elapsedMs / 1000
    txPerSecond = $success / ($_.elapsedMs / 1000)
  }
} | Format-Table -AutoSize
```

Room-level tx/s:

```powershell
$j.waves |
  ForEach-Object { $_.runs } |
  ForEach-Object {
    [pscustomobject]@{
      room = $_.runNumber
      wave = $_.waveNumber
      rpcUrl = $_.rpcUrl
      success = $_.successCount
      elapsedSec = $_.elapsedMs / 1000
      txPerSecond = $_.successCount / ($_.elapsedMs / 1000)
    }
  } | Format-Table -AutoSize
```

## Template Narasi untuk Thesis

Contoh narasi hasil controlled stress:

```text
Pengujian stress dilakukan dengan memodelkan satu TPS sebagai satu VotingRoom.
Setiap VotingRoom memiliki 30 EOA sebagai voter dan menjalankan vote secara concurrent.
Pada skenario staggered parallel, beberapa room dijalankan secara parallel per wave untuk mensimulasikan beberapa TPS yang mengirim hasil pada waktu berdekatan.
```

Contoh narasi reliability:

```text
Hasil pengujian menunjukkan seluruh transaksi vote berhasil tercatat on-chain.
Nilai successCount, totalVotesOnChain, dan eventCount sama dengan expectedVoteTransactions,
sehingga tidak terdapat kehilangan suara pada level smart contract.
```

Contoh narasi retry:

```text
Retry yang terjadi selama pengujian merepresentasikan kondisi transient pada RPC atau load generator,
bukan kegagalan logika voting. Hal ini ditunjukkan oleh failedAfterRetries bernilai 0
dan totalVotesOnChain tetap sama dengan jumlah transaksi vote yang diharapkan.
```

Contoh narasi throughput:

```text
Throughput dilaporkan pada tiga level: sampling-level tx/s untuk durasi end-to-end,
active wave tx/s untuk performa saat batch transaksi berjalan,
dan wave-level tx/s untuk melihat variasi performa antar-wave.
Pemisahan ini penting karena pengujian menggunakan dynamic delay antar-wave untuk menjaga kestabilan perangkat lokal.
```

## Ringkasan Cara Membaca Cepat

Urutan membaca yang disarankan:

```text
1. Buka summary.md.
2. Pastikan Success count, On-chain votes, dan Event count sesuai target.
3. Cek Failed vote count, Failed process room, dan timeout.
4. Cek Total submit retries dan failureReasonCounts.
5. Buka summary-waves.csv untuk melihat wave bermasalah.
6. Buka summary-rooms.csv untuk mencari room yang retry/lambat.
7. Jika perlu audit detail, buka room-vote-*.json dari resultPath.
8. Hitung tx/s sesuai level analisis: sampling, active wave, wave, atau room.
```

