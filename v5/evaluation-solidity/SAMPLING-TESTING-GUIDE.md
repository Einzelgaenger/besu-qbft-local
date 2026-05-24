# Sampling Testing Guide

Dokumen ini menjelaskan cara menjalankan dan membaca semua script sampling di `evaluation-solidity`.

Catatan istilah: di dokumen ini, **TPS** berarti **Tempat Pemungutan Suara**, bukan transaction per second.

## Model Testing

Mapping yang dipakai pada project v5:

```text
1 TPS simulasi = 1 VotingRoom / room
1 EOA = 1 voter simulasi
1 vote transaction = 1 suara dari voter di room tersebut
```

Default testing memakai:

```text
30 EOA per room
3 candidate per room
1 round voting per room
```

File akun yang dipakai:

```text
accounts/eoa-collections.json
```

EOA boleh dipakai ulang di room berbeda karena aturan "satu voter satu vote" berlaku per room dan per round. Untuk stress test parallel, script memakai offset EOA berbeda per room dalam wave yang sama agar nonce antar-room tidak bentrok.

## Persiapan Umum

Dari folder `v5`, jalankan network Besu:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
docker compose up -d
docker ps
```

Masuk ke folder evaluasi:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5\evaluation-solidity
npm run network:check
```

Jika akun EOA belum ada:

```powershell
npm run generate:eoa
```

Untuk stress test 5 room parallel, minimal perlu 150 EOA:

```powershell
$env:ACCOUNT_COUNT="150"
npm run generate:eoa
```

Untuk preset aman 2 room parallel, minimal perlu 60 EOA. Jika file sudah punya 150 EOA, tidak perlu generate ulang.

## Output Result

Semua hasil test masuk ke:

```text
results/
```

Setiap test membuat folder dengan format:

```text
results/[nama-testing]-[YYYYMMDD-HHmmss]/
```

Isi folder biasanya:

```text
room-vote-*.json                  hasil detail per room/TPS
sampling-[stage-id]-*.json        hasil aggregate/stage
```

Contoh:

```text
results/stage-5-tps-stress-main-20260520-125708/
  room-vote-stage-5-tps-stress-main-run-001-....json
  room-vote-stage-5-tps-stress-main-run-002-....json
  ...
  sampling-stage-5-tps-stress-main-....json
```

Jika ingin menentukan folder result sendiri:

```powershell
$env:RESULT_RUN_DIR="C:\Users\LEGION\Documents\Binus\Thesis\custom-result"
npm run sampling:tps-batch
```

## Kelompok 1: Sampling Transaksi Vote

Kelompok ini memakai vote transaction sebagai unit sample. Cocok untuk validasi flow, baseline ringan, dan pembanding latency.

### `npm run sampling:smoke`

```text
1 room x 30 vote = 30 vote sample
Mode vote: sequential
Room: sequential
```

Tujuan:

- memastikan flow dasar berjalan
- membuat room baru
- menambahkan voter dan candidate
- menjalankan start, vote, stop, inspect
- memastikan result JSON terbentuk

Command:

```powershell
npm run sampling:smoke
```

### `npm run sampling:baseline`

```text
3 room x 30 vote = 90 vote sample
Mode vote: sequential
Room: sequential
```

Tujuan:

- baseline latency normal
- pembanding terhadap mode concurrent
- mudah dibaca karena vote dikirim satu per satu

Command:

```powershell
npm run sampling:baseline
```

### `npm run sampling:main`

```text
13 room x 30 vote = 390 vote sample
Mode vote: concurrent
Room: sequential
```

Penting:

```text
Script ini bukan 390 TPS sample.
Script ini adalah 390 vote transaction dari 13 room.
```

Command:

```powershell
npm run sampling:main
```

### `npm run sampling:fault`

```text
2 room x 30 vote = 60 vote sample
Mode vote: concurrent
Room: sequential
Fault: 1 node Besu dimatikan
```

Default node yang dimatikan:

```text
besu-v5-node4
```

Command:

```powershell
npm run sampling:fault
```

Ganti node:

```powershell
$env:FAULT_NODE_CONTAINER="besu-v5-node3"
npm run sampling:fault
```

Jika node sudah dimatikan manual:

```powershell
$env:FAULT_SKIP_DOCKER_STOP="true"
npm run sampling:fault
```

## Kelompok 2: Sampling TPS Room

Kelompok ini lebih tepat untuk thesis jika unit sampling adalah TPS.

```text
1 TPS sample = 1 room
1 TPS room = 30 vote transaction
390 TPS room = 390 x 30 = 11.700 vote transaction
```

### `npm run sampling:tps-smoke`

```text
1 TPS room
30 vote
Mode vote: sequential
Room: sequential
```

Tujuan:

- validasi pemetaan 1 TPS = 1 room
- uji flow dasar sebelum batch besar

Command:

```powershell
npm run sampling:tps-smoke
```

### `npm run sampling:tps-baseline`

```text
3 TPS room
90 vote transaction
Mode vote: sequential
Room: sequential
```

Tujuan:

- baseline TPS dengan vote sequential
- pembanding untuk TPS concurrent

Command:

```powershell
npm run sampling:tps-baseline
```

### `npm run sampling:tps-batch`

```text
30 TPS room per batch
900 vote transaction per batch
Mode vote: concurrent
Room: sequential
```

Penting:

```text
30 room tidak berjalan bersamaan.
Room berjalan satu per satu.
Yang concurrent adalah 30 vote di dalam masing-masing room.
```

Command:

```powershell
$env:TPS_BATCH_INDEX="1"
npm run sampling:tps-batch
```

`TPS_BATCH_INDEX` hanya penanda nama stage/result, bukan pengubah logic.

Untuk 390 TPS:

```text
13 batch x 30 TPS room = 390 TPS room
```

### `npm run sampling:tps-main`

```text
390 TPS room
11.700 vote transaction
Mode vote: concurrent
Room: sequential
```

Tujuan:

- full main sampling TPS dalam satu proses
- controlled TPS sampling tanpa parallel antar-room

Untuk laptop 8GB, `sampling:tps-batch` 13 kali biasanya lebih aman daripada langsung `sampling:tps-main`.

Command:

```powershell
npm run sampling:tps-main
```

Versi pendek:

```powershell
$env:SAMPLING_ROOM_COUNT="10"
npm run sampling:tps-main
```

### `npm run sampling:tps-fault`

```text
2 TPS room
60 vote transaction
Mode vote: concurrent
Room: sequential
Fault: 1 node Besu dimatikan
```

Command:

```powershell
npm run sampling:tps-fault
```

## Kelompok 3: TPS Stress / Peak-Load

Kelompok ini mensimulasikan beberapa TPS submit bersamaan. Perbedaannya:

```text
sampling:tps-main:
Room antar-TPS sequential.
Vote di dalam room concurrent.

sampling:tps-stress-*:
Beberapa room TPS berjalan parallel per wave.
Vote di dalam masing-masing room juga concurrent.
```

### `npm run sampling:tps-stress-batch`

```text
Default:
30 TPS room
5 room parallel per wave
30 vote concurrent per room
900 vote transaction
```

Tujuan:

- peak-load kecil
- uji beberapa TPS room submit bersamaan
- validasi setting sebelum stress main

Command:

```powershell
$env:TPS_BATCH_INDEX="1"
npm run sampling:tps-stress-batch
```

Untuk laptop 8GB, lebih aman:

```powershell
$env:STRESS_PARALLEL_ROOMS="2"
$env:STRESS_TOTAL_TPS="30"
$env:STRESS_WAVE_DELAY_MS="15000"
$env:STRESS_STAGGER_WINDOW_MS="8000"
npm run sampling:tps-stress-batch
```

### `npm run sampling:tps-stress-main`

```text
Default:
390 TPS room
5 room parallel per wave
30 vote concurrent per room
11.700 vote transaction
```

Tujuan:

- stress test utama
- menguji multi-room concurrency pada jaringan Besu QBFT lokal

Command:

```powershell
npm run sampling:tps-stress-main
```

Catatan:

```text
Default 5 room parallel cukup agresif untuk laptop 8GB.
Untuk data final yang stabil, gunakan preset basic-safe atau recovery-detailed.
```

## Kelompok 4: Preset Stress Main Aman

### `npm run sampling:tps-stress-main:safe`

Preset aman umum.

```text
390 TPS room
2 room parallel per wave
30 vote concurrent per room
health-check aktif
nonce retry aktif
```

Command:

```powershell
npm run sampling:tps-stress-main:safe
```

### `npm run sampling:tps-stress-main:basic-safe`

Preset ini memperbaiki poin minimal:

```text
1. Parallel room diturunkan menjadi 2.
2. Nonce/RPC transient error dianggap retryable.
```

Konfigurasi utama:

```text
STRESS_PARALLEL_ROOMS=2
STRESS_TOTAL_TPS=390
STRESS_WAVE_DELAY_MS=15000
STRESS_STAGGER_WINDOW_MS=8000
VOTE_SUBMIT_RETRY_ATTEMPTS=5
VOTE_RETRY_NONCE_ERRORS=true
VOTE_USE_PENDING_NONCE=true
```

Tujuan:

- menjaga test tetap parallel
- mengurangi risiko `other side closed`
- mengurangi risiko `Nonce too low`
- tetap bounded, tidak mencoba recovery sampai sangat lama

Command:

```powershell
npm run sampling:tps-stress-main:basic-safe
```

### `npm run sampling:tps-stress-main:recovery-detailed`

Preset ini untuk pengambilan data thesis yang lebih detail.

Perbaikan yang diaktifkan:

```text
1. Parallel room = 2.
2. Nonce/RPC error retryable.
3. Pending nonce digunakan saat submit vote.
4. Recovery sampai sukses dibatasi max attempt.
5. Final reconciliation dengan contract state.
6. Dynamic wave delay.
7. Metric retry/recovery/health lebih detail.
```

Konfigurasi utama:

```text
STRESS_PARALLEL_ROOMS=2
STRESS_TOTAL_TPS=390
STRESS_WAVE_DELAY_MS=15000
STRESS_STAGGER_WINDOW_MS=8000
STRESS_DYNAMIC_WAVE_DELAY_ENABLED=true
STRESS_WAVE_DELAY_MIN_MS=10000
STRESS_WAVE_DELAY_MAX_MS=30000
STRESS_WAVE_DELAY_JITTER_MS=5000
VOTE_SUBMIT_RETRY_ATTEMPTS=5
VOTE_RECOVERY_UNTIL_SUCCESS=true
VOTE_RECOVERY_MAX_ATTEMPTS=10
VOTE_RETRY_NONCE_ERRORS=true
VOTE_USE_PENDING_NONCE=true
VOTE_FINAL_RECONCILIATION_ENABLED=true
VOTE_RUN_TIMEOUT_MS=240000
```

Command:

```powershell
npm run sampling:tps-stress-main:recovery-detailed
```

Kapan dipakai:

- saat ingin melihat reliability dan recovery, bukan hanya raw stress
- saat ingin tahu berapa banyak retry yang terjadi
- saat ingin mencatat berapa lama sistem tidak sehat
- saat ingin hasil akhir lebih cocok untuk analisis thesis

### `npm run sampling:tps-stress-main:light`

Preset paling aman untuk laptop 8GB.

```text
390 TPS room
1 room parallel per wave
30 vote concurrent per room
multi-RPC aktif
health-check aktif
retry/recovery aktif
dynamic wave delay aktif
```

Command:

```powershell
npm run sampling:tps-stress-main:light
```

Kapan dipakai:

- validasi awal setelah reset node/deploy ulang
- memastikan recovery logic berjalan tanpa beban tinggi
- mengambil baseline stress yang paling stabil

### `npm run sampling:tps-stress-main:balanced`

Preset rekomendasi utama untuk pengambilan data thesis pada laptop 8GB.

```text
390 TPS room
2 room parallel per wave
30 vote concurrent per room
multi-RPC aktif
health-check aktif
retry/recovery aktif
dynamic wave delay aktif
```

Command:

```powershell
npm run sampling:tps-stress-main:balanced
```

Kapan dipakai:

- simulasi beberapa TPS mengirim data pada waktu berdekatan
- menjaga beban tetap realistis tetapi tidak terlalu agresif
- hasil lebih cocok untuk narasi reliability, retry, dan recovery

### `npm run sampling:tps-stress-main:aggressive`

Preset batas atas untuk melihat daya tahan sistem.

```text
390 TPS room
5 room parallel per wave
30 vote concurrent per room
multi-RPC aktif
health-check aktif
retry/recovery aktif
dynamic wave delay aktif
```

Command:

```powershell
npm run sampling:tps-stress-main:aggressive
```

Kapan dipakai:

- uji peak-load yang lebih berat
- mencari titik mulai munculnya bottleneck RPC, txpool, CPU, RAM, atau disk I/O
- bukan pilihan pertama untuk data final jika laptop mulai sering retry/fail

## Multi-RPC pada Stress Test

Preset `safe`, `basic-safe`, `recovery-detailed`, `light`, `balanced`, dan `aggressive` memakai beberapa endpoint RPC:

```text
STRESS_RPC_URLS=http://127.0.0.1:8545,http://127.0.0.1:8546,http://127.0.0.1:8547,http://127.0.0.1:8548
```

Artinya room yang berjalan parallel dibagi ke RPC node berbeda. Tujuannya mengurangi bottleneck jika semua request masuk ke satu endpoint RPC saja.

Contoh:

```text
room run 1 -> RPC 8545
room run 2 -> RPC 8546
room run 3 -> RPC 8547
room run 4 -> RPC 8548
room run 5 -> balik lagi ke RPC 8545
```

Catatan penting:

- multi-RPC tidak mengubah aturan konsensus QBFT
- semua transaksi tetap masuk ke chain yang sama
- multi-RPC hanya membagi beban JSON-RPC/load generator
- jika salah satu RPC tidak sehat, script mencatat health check dan retry sesuai konfigurasi
- preflight health pada setiap wave mengecek RPC yang akan dipakai oleh wave tersebut

## Cara Kerja Retry dan Recovery

Saat vote gagal submit/confirm, script melakukan:

```text
1. Cek apakah voter sudah tercatat vote:
   lastVotedRound[voter] == currentRound

2. Jika sudah vote:
   row ditandai sukses by contract state.

3. Jika belum vote:
   script menunggu RPC health-check hijau.

4. Setelah RPC sehat:
   script retry vote.

5. Jika final reconciliation aktif:
   setelah inspectRound, failed rows dicek lagi ke contract state.
```

RPC dianggap hijau jika `getBlockNumber()` sukses beberapa kali berturut-turut sesuai:

```text
VOTE_HEALTH_CHECK_GREEN_STREAK
```

Setiap vote menyimpan detail attempt:

```text
voteRun.rows[].attempts[]
voteRun.rows[].submitAttempts
voteRun.rows[].submitRetries
voteRun.rows[].failureReasons
voteRun.rows[].firstRetryAt
voteRun.rows[].retryRecoveryElapsedMs
```

Cara baca waktu pada vote:

```text
successfulAttemptLatencyMs
Durasi attempt yang benar-benar berhasil, dihitung dari tx hash berhasil didapat sampai receipt confirm.

successfulAttemptSubmitElapsedMs
Durasi request submit pada attempt yang berhasil, sebelum tx hash didapat.

totalVoteElapsedMs
Durasi dari attempt pertama sampai status akhir vote.

retryRecoveryElapsedMs
Durasi sejak retry pertama sampai vote akhirnya sukses atau selesai.
```

Jika attempt 1, 2, dan 3 gagal, lalu attempt 4 berhasil, maka:

```text
successfulAttemptLatencyMs = waktu attempt ke-4 sampai receipt confirm
submitRetries              = 3
failureReasons             = alasan gagal attempt 1-3
retryRecoveryElapsedMs     = waktu dari retry pertama sampai sukses
totalVoteElapsedMs         = waktu dari attempt pertama sampai sukses
```

## Dynamic Wave Delay

Pada preset `recovery-detailed`, `light`, `balanced`, dan `aggressive`, jeda antar-wave tidak statis. Script mencatat keputusan delay di:

```text
waves[].nextWaveDelay
```

Delay bisa naik jika:

```text
ada failed vote
ada failed process room
failed health probe tinggi
health wait tinggi
```

Delay bisa turun jika wave stabil.

Data yang dicatat:

```text
previousBaseDelayMs
nextBaseDelayMs
jitterMs
actualDelayMs
reasons
waveSummary
```

## Output Tambahan Stress Test

Selain JSON utama, stress runner juga membuat file ringkasan:

```text
summary.md
summary-rooms.csv
summary-waves.csv
```

Isi ringkasnya:

```text
summary.md
Ringkasan human-readable untuk cepat melihat hasil akhir.

summary-rooms.csv
Satu baris per room/TPS. Cocok dibuka di Excel untuk analisis latency, retry, RPC, dan status.

summary-waves.csv
Satu baris per wave/batch parallel. Cocok untuk melihat wave mana yang berat atau banyak retry.
```

File JSON utama tetap menjadi sumber data paling lengkap.

## Cara Membaca Result JSON

### Aggregate File

File:

```text
sampling-stage-*.json
```

Field penting:

```text
expectedVoteTransactions  target transaksi vote
totals.successCount       vote sukses menurut script
totals.failedVoteCount    vote gagal menurut script
totals.totalVotesOnChain  vote yang benar-benar tercatat on-chain
totals.eventCount         jumlah event VoteCast
averages.avgLatencyMs     rata-rata latency vote sukses
averages.avgSuccessfulAttemptLatencyMs
                         rata-rata latency attempt yang benar-benar berhasil
averages.avgTotalVoteElapsedMs
                         rata-rata waktu dari attempt pertama sampai status akhir
averages.avgRetryRecoveryElapsedMs
                         rata-rata waktu sejak retry pertama sampai berhasil
averages.avgGasUsed       rata-rata gas vote sukses
elapsedMs                 durasi test dari awal command sampai selesai
rpcSummary                ringkasan performa per endpoint RPC
storage.before/after      snapshot ukuran data node sebelum dan sesudah test
rpcHealth.before/after    snapshot health RPC sebelum dan sesudah test
```

### Retry Totals

Pada stress result:

```text
retryTotals.totalSubmitAttempts
retryTotals.totalSubmitRetries
retryTotals.averageSubmitAttemptsPerVote
retryTotals.averageSubmitRetriesPerVote
retryTotals.maxSubmitRetriesPerVote
retryTotals.votesRecoveredAfterRetry
retryTotals.failedAfterRetries
retryTotals.confirmedByContractStateCount
retryTotals.recoveredByFinalReconciliationCount
retryTotals.healthWaitSeconds
retryTotals.systemUnreachableApproxSeconds
retryTotals.averageRetryRecoveryElapsedMs
retryTotals.maxRetryRecoveryElapsedMs
retryTotals.submitAttemptDistribution
retryTotals.submitRetryDistribution
retryTotals.failureReasonCounts
```

Interpretasi:

```text
votesRecoveredAfterRetry:
Jumlah vote yang awalnya bermasalah tetapi berhasil setelah retry.

confirmedByContractStateCount:
Submit response hilang atau retry bermasalah, tapi contract state membuktikan voter sudah vote.

recoveredByFinalReconciliationCount:
Rows yang awalnya failed tetapi dipulihkan setelah pengecekan akhir ke contract state.

systemUnreachableApproxSeconds:
Estimasi kumulatif waktu RPC tidak bisa dihubungi berdasarkan failed health probe.
Ini bukan downtime wall-clock murni karena banyak vote berjalan paralel.

submitAttemptDistribution:
Distribusi jumlah attempt. Misalnya {"1": 11600, "2": 80, "3": 20}.

submitRetryDistribution:
Distribusi jumlah retry. Retry 0 berarti langsung sukses pada attempt pertama.

failureReasonCounts:
Jumlah kemunculan alasan gagal, misalnya `other side closed`, `timeout`, atau nonce error.
```

### Room File

File:

```text
room-vote-*.json
```

Field penting:

```text
voteRun.rows[]              detail setiap voter
voteRun.retrySummary        summary retry per room
voteRun.avgSuccessfulAttemptLatencyMs
                            latency attempt sukses saja
voteRun.avgTotalVoteElapsedMs
                            total elapsed dari attempt pertama
voteRun.avgRetryRecoveryElapsedMs
                            elapsed sejak retry pertama
inspect.totalVotes          total vote on-chain di room itu
inspect.eventCount          event VoteCast di room itu
finalReconciliation         hasil rekonsiliasi failed rows
```

Untuk melihat vote yang retry:

```text
voteRun.rows[].submitAttempts > 1
```

Untuk melihat vote yang dipulihkan oleh state contract:

```text
voteRun.rows[].confirmedByContractState = true
```

Untuk melihat durasi sejak retry pertama sampai sukses:

```text
voteRun.rows[].retryRecoveryElapsedMs
```

Untuk melihat attempt mana yang gagal dan alasannya:

```text
voteRun.rows[].attempts[]
voteRun.rows[].failureReasons
```

## Variabel Konfigurasi Penting

### Sampling Sequential

```text
SAMPLING_ROOM_COUNT
SAMPLING_ROOM_DELAY_MS
TPS_BATCH_INDEX
POPULATION_TPS
VOTE_RUN_TIMEOUT_MS
```

### Stress

```text
STRESS_TOTAL_TPS
STRESS_PARALLEL_ROOMS
STRESS_VOTERS_PER_ROOM
STRESS_STAGGER_WINDOW_MS
STRESS_WAVE_DELAY_MS
STRESS_RPC_URLS
STRESS_PREFLIGHT_RPC_HEALTH_ENABLED
STRESS_PREFLIGHT_RPC_HEALTH_REQUIRE_ALL
STRESS_PREFLIGHT_RPC_HEALTH_TIMEOUT_MS
STRESS_PREFLIGHT_RPC_HEALTH_INTERVAL_MS
```

### Retry dan Health

```text
VOTE_SUBMIT_RETRY_ATTEMPTS
VOTE_SUBMIT_RETRY_DELAY_MS
VOTE_HEALTH_CHECK_ENABLED
VOTE_HEALTH_CHECK_TIMEOUT_MS
VOTE_HEALTH_CHECK_INTERVAL_MS
VOTE_HEALTH_CHECK_GREEN_STREAK
VOTE_RETRY_NONCE_ERRORS
VOTE_USE_PENDING_NONCE
VOTE_RECOVERY_UNTIL_SUCCESS
VOTE_RECOVERY_MAX_ATTEMPTS
VOTE_FINAL_RECONCILIATION_ENABLED
```

### Dynamic Wave Delay

```text
STRESS_DYNAMIC_WAVE_DELAY_ENABLED
STRESS_WAVE_DELAY_MIN_MS
STRESS_WAVE_DELAY_MAX_MS
STRESS_WAVE_DELAY_JITTER_MS
STRESS_WAVE_DELAY_INCREASE_MS
STRESS_WAVE_DELAY_DECREASE_MS
STRESS_WAVE_DELAY_FAILED_PROBE_THRESHOLD
STRESS_WAVE_DELAY_HEALTH_WAIT_THRESHOLD_MS
```

## Monitoring Storage Node

Dari folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
```

Cek byte per node:

```powershell
Get-ChildItem .\nodes\node1\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node2\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node3\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node4\data -Recurse | Measure-Object -Property Length -Sum
```

Cek MB semua node:

```powershell
1..4 | ForEach-Object {
  $sum = (Get-ChildItem ".\nodes\node$_\data" -Recurse | Measure-Object -Property Length -Sum).Sum
  "node$_ = {0:N2} MB" -f ($sum / 1MB)
}
```

Cara baca:

```text
Count = jumlah file
Sum   = total ukuran file dalam byte
MB    = Sum / 1MB
```

## Rekomendasi Urutan Thesis

Urutan yang disarankan untuk perangkat 8GB RAM dan storage 50GB:

```text
1. npm run sampling:tps-smoke
   Validasi 1 TPS.

2. npm run sampling:tps-baseline
   Baseline sequential.

3. npm run sampling:tps-batch
   Jalankan beberapa batch untuk main sampling controlled.

4. npm run sampling:tps-fault
   Fault tolerance 1 node mati.

5. npm run sampling:tps-stress-batch
   Uji peak-load kecil.

6. npm run sampling:tps-stress-main:light
   Validasi stress main paling aman.

7. npm run sampling:tps-stress-main:balanced
   Stress main rekomendasi untuk data thesis.

8. npm run sampling:tps-stress-main:aggressive
   Optional boundary test jika ingin melihat batas sistem.
```

Untuk klaim 390 TPS sample, gunakan:

```text
sampling:tps-main
sampling:tps-batch
sampling:tps-stress-main:basic-safe
sampling:tps-stress-main:recovery-detailed
sampling:tps-stress-main:balanced
```

Jangan memakai `sampling:main` sebagai klaim 390 TPS, karena `sampling:main` adalah 390 vote sample, bukan 390 TPS room.

## Narasi Metodologi Singkat

Contoh narasi:

> Penelitian ini memodelkan satu TPS sebagai satu VotingRoom pada smart contract. Setiap room berisi 30 EOA sebagai voter simulasi. Pengujian controlled menjalankan room secara sequential dengan vote concurrent di dalam room. Pengujian stress menjalankan beberapa TPS room secara parallel per wave untuk mensimulasikan beberapa TPS yang mengirim data pada waktu berdekatan.

Untuk recovery-detailed:

> Pada pengujian stress recovery, sistem menerapkan health-aware retry. Ketika transaksi vote gagal karena RPC/nonce/transient error, script memeriksa status on-chain voter melalui `lastVotedRound`, menunggu RPC kembali sehat, lalu melakukan retry sampai batas maksimum. Semua retry, durasi recovery, health wait, final reconciliation, dan dynamic wave delay dicatat ke result JSON untuk analisis reliability.

Untuk balanced stress:

> Pada pengujian stress balanced, sistem menjalankan dua TPS room secara parallel per wave, masing-masing berisi 30 vote concurrent. Beban JSON-RPC dibagi ke beberapa endpoint RPC node Besu, dan jeda antar-wave disesuaikan secara dinamis berdasarkan health probe, retry, serta kegagalan vote. Latency transaksi yang berhasil dipisahkan dari waktu recovery agar analisis performa tidak tercampur dengan waktu tunggu akibat retry.
