# Metodologi Penelitian dan Testing Sampling TPS Stress Balanced

Dokumen ini menjelaskan metodologi penelitian, desain eksperimen, topologi jaringan, konfigurasi node, alur pengujian, metrik, dan cara membaca hasil untuk command:

```powershell
npm run sampling:tps-stress-main:balanced
```

Catatan istilah: dalam penelitian ini, `TPS` berarti **Tempat Pemungutan Suara**, bukan transaction per second. Untuk performa transaksi, dokumen ini memakai istilah `transaction throughput`, `vote transaction`, atau `tx/s`.

## 1. Tujuan Penelitian

Pengujian `sampling:tps-stress-main:balanced` dirancang untuk mengevaluasi kemampuan sistem e-voting berbasis smart contract pada jaringan private blockchain Hyperledger Besu dengan konsensus QBFT. Fokus utamanya adalah mengamati reliabilitas, konsistensi data on-chain, latensi, retry/recovery, dan kemampuan jaringan memproses beberapa TPS simulasi yang berjalan berdekatan secara waktu.

Secara konseptual, penelitian ini menguji skenario bahwa banyak TPS mengirimkan hasil voting ke blockchain dalam waktu yang berdekatan. Setiap TPS direpresentasikan sebagai satu smart contract `VotingRoom`, dan setiap pemilih direpresentasikan sebagai satu Externally Owned Account atau EOA.

Tujuan khusus pengujian:

1. Menguji apakah 390 TPS simulasi dapat diproses pada jaringan Besu QBFT lokal.
2. Menguji konsistensi antara transaksi sukses menurut script, vote yang tersimpan di contract, dan event `VoteCast`.
3. Mengamati efek beban paralel kecil terhadap latensi transaksi vote.
4. Mengukur kebutuhan retry ketika terjadi error sementara pada RPC atau nonce.
5. Mengukur efektivitas recovery berbasis retry, health-check RPC, dan final reconciliation terhadap state smart contract.
6. Menyediakan data kuantitatif yang dapat dipakai untuk analisis penelitian, misalnya success rate, failure rate, latency, gas usage, retry count, dan on-chain vote completeness.

## 2. Objek yang Diuji

Sistem yang diuji adalah implementasi smart contract voting v5 pada folder:

```text
v5\evaluation-solidity
```

Kontrak utama:

| Kontrak | Peran |
|---|---|
| `VotingRoom` | Merepresentasikan satu TPS simulasi. Kontrak ini menyimpan voter, candidate, status round, vote per candidate, total vote, dan history round. |
| `RoomFactory` | Membuat room baru menggunakan pola EIP-1167 minimal proxy. Setiap room adalah clone dari implementasi `VotingRoom`. |
| `VotingResultCenter` | Menyimpan publikasi hasil round dari room yang valid menurut `RoomFactory`. |

Relasi antar-kontrak:

```text
RoomFactory
  -> membuat clone VotingRoom

VotingRoom
  -> menerima voter
  -> menerima candidate
  -> start round
  -> menerima vote langsung dari EOA voter
  -> stop round
  -> menyimpan round history
  -> submitRoundHistory ke VotingResultCenter

VotingResultCenter
  -> menerima hasil round hanya dari room yang terdaftar di RoomFactory
```

Satu vote dikirim langsung oleh EOA pemilih melalui fungsi:

```solidity
vote(uint256 candidateId)
```

Aturan voting yang divalidasi oleh contract:

1. Pemilih harus terdaftar sebagai voter.
2. Candidate harus valid.
3. Room harus berada dalam state `Active`.
4. Satu voter hanya boleh vote satu kali per round.
5. Vote yang berhasil akan menaikkan `roundVotes[round][candidateId]` dan `roundTotalVotes[round]`.
6. Contract memancarkan event `VoteCast`.

## 3. Topologi Network Besu QBFT

Network dijalankan menggunakan Docker Compose dari folder:

```text
v5
```

Command untuk menjalankan network:

```powershell
docker compose -f .\docker-compose.yml up -d
```

Topologi terdiri dari 4 node validator Besu dalam satu Docker bridge network:

```text
besu-v5-net
subnet: 172.21.0.0/24
```

Detail node:

| Node | Container | IP Docker | RPC Host Port | P2P Host Port | Role |
|---|---|---:|---:|---:|---|
| Node 1 | `besu-v5-node1` | `172.21.0.11` | `8545` | `30303` | Validator dan bootnode |
| Node 2 | `besu-v5-node2` | `172.21.0.12` | `8546` | `30304` | Validator |
| Node 3 | `besu-v5-node3` | `172.21.0.13` | `8547` | `30305` | Validator |
| Node 4 | `besu-v5-node4` | `172.21.0.14` | `8548` | `30306` | Validator |

Node 2, Node 3, dan Node 4 menggunakan `BOOTNODE_URL` dari file:

```text
v5\.env
```

Contoh isi:

```text
BOOTNODE_URL=enode://PUBLIC_KEY_NODE_1@172.21.0.11:30303
```

RPC endpoint yang dipakai oleh preset balanced:

```text
http://127.0.0.1:8545
http://127.0.0.1:8546
http://127.0.0.1:8547
http://127.0.0.1:8548
```

Arsitektur logis:

```text
Hardhat / Script Evaluasi
  -> RPC 8545 / node1
  -> RPC 8546 / node2
  -> RPC 8547 / node3
  -> RPC 8548 / node4

Besu Validator Network
  node1 <-> node2 <-> node3 <-> node4
  consensus: QBFT

Smart Contract Layer
  RoomFactory
  VotingRoom clone per TPS
  VotingResultCenter
```

## 4. Konfigurasi Konsensus dan Genesis

Network memakai konsensus QBFT dengan chain id:

```text
chainId = 1337
```

Parameter penting dari `config\qbftConfigFile.json`:

| Parameter | Nilai | Makna |
|---|---:|---|
| `blockperiodseconds` | `2` | Target interval produksi block sekitar 2 detik. |
| `epochlength` | `30000` | Periode epoch QBFT. |
| `requesttimeoutseconds` | `4` | Timeout request konsensus. |
| `zeroBaseFee` | `true` | Base fee dibuat nol untuk private network. |
| `gasLimit` | `0x1fffffffffffff` | Gas limit besar untuk mendukung eksperimen lokal. |

Setiap node menjalankan RPC API:

```text
ETH, NET, WEB3, QBFT, TXPOOL
```

RPC `TXPOOL` dipakai oleh script untuk mengambil snapshot `txpool_besuStatistics` saat health-check.

## 5. Desain Penelitian

Jenis pengujian ini adalah eksperimen kuantitatif berbasis simulasi beban pada private blockchain. Unit observasi utama adalah TPS simulasi, sedangkan unit transaksi adalah vote transaction.

Model pemetaan:

```text
1 TPS simulasi = 1 VotingRoom
1 VotingRoom = 1 round voting
1 EOA = 1 voter simulasi
1 vote transaction = 1 suara dari 1 voter
```

Pada command balanced:

```text
390 TPS room
30 voter per room
2 room parallel per wave
30 vote concurrent per room
195 wave
11.700 expected vote transaction
```

Rumus:

```text
expectedVoteTransactions = totalTpsRoom x votersPerRoom
expectedVoteTransactions = 390 x 30 = 11.700
```

Jumlah wave:

```text
totalWaves = ceil(totalTpsRoom / parallelRooms)
totalWaves = ceil(390 / 2) = 195
```

Jumlah vote yang dikirim dalam satu wave:

```text
votePerWave = parallelRooms x votersPerRoom
votePerWave = 2 x 30 = 60
```

Dalam satu wave, dua TPS room berjalan paralel. Di dalam setiap room, 30 voter mengirim vote secara concurrent. Dengan demikian, beban eksperimen terjadi pada dua tingkat:

1. **Inter-room concurrency**: dua TPS room berjalan bersamaan.
2. **Intra-room concurrency**: 30 vote dalam tiap room dikirim bersamaan.

## 6. Justifikasi Preset Balanced

Command `npm run sampling:tps-stress-main:balanced` menjalankan file:

```text
scripts\run-tps-stress-main-balanced.ps1
```

Preset ini dibuat sebagai kompromi antara realism dan stabilitas perangkat lokal, khususnya laptop dengan RAM sekitar 8GB. Default stress main sebenarnya dapat menjalankan 5 room paralel, tetapi konfigurasi balanced menurunkan parallel room menjadi 2 agar beban tidak terlalu agresif.

Alasan ilmiah penggunaan preset balanced:

1. Beban tetap paralel, sehingga mendekati kondisi beberapa TPS mengirim data pada waktu berdekatan.
2. Jumlah room paralel tidak terlalu tinggi, sehingga mengurangi risiko bottleneck yang berasal dari keterbatasan hardware lokal, bukan dari desain blockchain.
3. Multi-RPC endpoint digunakan untuk mendistribusikan request ke empat node Besu.
4. Dynamic wave delay digunakan untuk memberi waktu pemulihan ketika RPC menunjukkan gejala tidak sehat.
5. Retry dan final reconciliation diaktifkan agar error sementara pada RPC tidak langsung dianggap sebagai kegagalan final jika state contract membuktikan vote sudah masuk.

## 7. Parameter Eksperimen Balanced

Parameter utama yang diset oleh preset balanced:

| Env | Nilai | Fungsi |
|---|---:|---|
| `STRESS_PARALLEL_ROOMS` | `2` | Jumlah room paralel per wave. |
| `STRESS_TOTAL_TPS` | `390` | Jumlah total TPS room yang diuji. |
| `STRESS_WAVE_DELAY_MS` | `15000` | Base delay antar-wave. |
| `STRESS_STAGGER_WINDOW_MS` | `8000` | Jendela random delay launch room di dalam wave. |
| `STRESS_RPC_URLS` | `8545,8546,8547,8548` | Daftar RPC yang dipakai bergantian. |
| `STRESS_PREFLIGHT_RPC_HEALTH_ENABLED` | `true` | Health-check sebelum wave dijalankan. |
| `STRESS_PREFLIGHT_RPC_HEALTH_REQUIRE_ALL` | `true` | Semua RPC yang dipakai wave harus sehat. |
| `STRESS_DYNAMIC_WAVE_DELAY_ENABLED` | `true` | Delay antar-wave disesuaikan dengan kondisi wave sebelumnya. |
| `STRESS_WAVE_DELAY_MIN_MS` | `10000` | Delay minimum antar-wave. |
| `STRESS_WAVE_DELAY_MAX_MS` | `30000` | Delay maksimum antar-wave. |
| `STRESS_WAVE_DELAY_JITTER_MS` | `5000` | Random jitter untuk menghindari pola beban terlalu deterministik. |
| `STRESS_WAVE_DELAY_INCREASE_MS` | `5000` | Penambahan delay jika wave bermasalah. |
| `STRESS_WAVE_DELAY_DECREASE_MS` | `2000` | Pengurangan delay jika wave stabil. |
| `VOTE_SUBMIT_RETRY_ATTEMPTS` | `5` | Jumlah attempt submit dasar. |
| `VOTE_RECOVERY_UNTIL_SUCCESS` | `true` | Recovery lanjut sampai sukses atau mencapai batas. |
| `VOTE_RECOVERY_MAX_ATTEMPTS` | `10` | Batas attempt maksimal saat recovery. |
| `VOTE_SUBMIT_RETRY_DELAY_MS` | `2000` | Delay antar-retry submit. |
| `VOTE_HEALTH_CHECK_ENABLED` | `true` | Health-check sebelum retry. |
| `VOTE_HEALTH_CHECK_TIMEOUT_MS` | `45000` | Timeout health-check vote. |
| `VOTE_HEALTH_CHECK_INTERVAL_MS` | `1000` | Interval probe health-check. |
| `VOTE_HEALTH_CHECK_GREEN_STREAK` | `3` | Jumlah probe sehat beruntun sebelum retry dilanjutkan. |
| `VOTE_RETRY_NONCE_ERRORS` | `true` | Nonce error dianggap retryable. |
| `VOTE_USE_PENDING_NONCE` | `true` | Nonce diambil dari pending nonce untuk mengurangi konflik. |
| `VOTE_FINAL_RECONCILIATION_ENABLED` | `true` | Failed row dicek ulang terhadap state contract. |
| `VOTE_RUN_TIMEOUT_MS` | `240000` | Timeout vote run per room, 240 detik. |

Parameter yang dihasilkan dari konfigurasi:

| Parameter Turunan | Nilai |
|---|---:|
| Total TPS room | `390` |
| Voter per room | `30` |
| Expected vote transaction | `11.700` |
| Room paralel per wave | `2` |
| Total wave | `195` |
| Vote concurrent per wave | `60` |
| Minimal unique EOA per wave | `60` |

Jika file akun berisi 150 EOA, preset balanced tetap valid. Script hanya membutuhkan minimal 60 EOA unik per wave karena EOA dapat dipakai ulang setelah wave selesai. Reuse EOA antar-wave aman karena aturan satu vote berlaku per room dan per round, bukan global antar-room.

## 8. Persiapan Eksperimen

### 8.1 Menjalankan Network Besu

Dari folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
docker compose -f .\docker-compose.yml up -d
docker ps
```

Ekspektasi container:

```text
besu-v5-node1
besu-v5-node2
besu-v5-node3
besu-v5-node4
```

### 8.2 Mengecek Health Network

Dari folder `v5\evaluation-solidity`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5\evaluation-solidity
npm run network:check
```

Kondisi yang diharapkan:

1. Semua endpoint RPC merespons.
2. Chain id adalah `1337`.
3. Node 1 memiliki peer sekitar `0x3` ketika 4 node hidup.
4. Block number bertambah.
5. Validator QBFT dapat dibaca melalui `qbft_getValidatorsByBlockNumber`.

### 8.3 Menyiapkan Akun EOA

Untuk balanced, minimal akun yang diperlukan adalah:

```text
STRESS_PARALLEL_ROOMS x STRESS_VOTERS_PER_ROOM = 2 x 30 = 60 EOA
```

Namun untuk eksperimen lebih fleksibel, misalnya jika ingin menjalankan preset agresif atau variasi 5 room paralel, disarankan membuat 150 EOA:

```powershell
$env:ACCOUNT_COUNT="150"
npm run generate:eoa
```

Output:

```text
accounts\eoa-collections.json
```

File ini berisi address, private key, dan metadata EOA. EOA pertama pada setiap slice `ACCOUNT_OFFSET` menjadi admin room untuk room tersebut.

### 8.4 Compile Contract

```powershell
npm run compile
```

### 8.5 Deployment System

Jika file deployment belum ada atau ingin deploy ulang:

```powershell
$env:REDEPLOY_SYSTEM="true"
$env:ROOM_MODE="new"
npm run room:test
Remove-Item Env:\REDEPLOY_SYSTEM
```

File deployment:

```text
deployments\room-system.json
```

Berisi address:

1. `votingRoomImplementation`
2. `roomFactory`
3. `votingResultCenter`
4. `admin`
5. `network`
6. `rpcUrl`
7. `chainId`
8. `deployedAt`

Pada stress test, room baru akan dibuat melalui `RoomFactory` yang tercatat pada file deployment tersebut.

## 9. Prosedur Menjalankan Testing Balanced

Dari folder:

```text
v5\evaluation-solidity
```

Jalankan command:

```powershell
npm run sampling:tps-stress-main:balanced
```

Secara internal, command tersebut melakukan urutan berikut:

```text
npm script
  -> powershell scripts/run-tps-stress-main-balanced.ps1
  -> set env preset balanced
  -> npm run sampling:tps-stress-main
  -> node scripts/sampling-tps-stress-main.js
  -> runStaggeredParallelTpsStage(...)
  -> spawn Hardhat child process per room
  -> hardhat run scripts/run-room-test.js --network besu
```

Dengan kata lain, balanced adalah wrapper preset untuk `sampling:tps-stress-main`. File `sampling-tps-stress-main.js` mendefinisikan stage utama, sedangkan file PowerShell balanced mengubah konfigurasi runtime melalui environment variable.

## 10. Alur Testing per Stage

### 10.1 Inisialisasi Stage

Runner membaca konfigurasi:

1. Total TPS room.
2. Jumlah room paralel.
3. Jumlah voter per room.
4. Daftar RPC endpoint.
5. Setting dynamic wave delay.
6. Setting retry, recovery, health-check, dan timeout.

Runner juga membaca file:

```text
accounts\eoa-collections.json
```

Jika jumlah EOA kurang dari `parallelRooms x votersPerRoom`, proses berhenti dengan error.

### 10.2 Preflight Funding

Sebelum wave dimulai, runner mengecek balance EOA yang dibutuhkan per wave. Jika balance kurang dari batas minimal, runner mengirim dana dari deployer default.

Funder default:

```text
0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
```

Private key default:

```text
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Nilai funding default:

```text
1 ETH-equivalent private network token per EOA
```

Karena network memakai gas price 0, funding terutama menjaga agar akun memiliki saldo untuk kompatibilitas transaksi.

### 10.3 Pembentukan Wave

Runner membagi 390 room ke dalam 195 wave:

```text
Wave 1: room 1 dan room 2
Wave 2: room 3 dan room 4
...
Wave 195: room 389 dan room 390
```

Setiap room dalam wave mendapat:

1. `runNumber`
2. `waveNumber`
3. `slotNumber`
4. `accountOffset`
5. `rpcUrl`
6. `rpcLabel`

Untuk balanced:

```text
slot 1 -> ACCOUNT_OFFSET = 0
slot 2 -> ACCOUNT_OFFSET = 30
```

Dengan demikian, dua room paralel dalam wave yang sama memakai 60 EOA unik:

```text
room slot 1 memakai EOA index 1-30
room slot 2 memakai EOA index 31-60
```

EOA dapat dipakai ulang pada wave berikutnya karena setiap wave sudah selesai sebelum wave selanjutnya dimulai.

### 10.4 Distribusi RPC

Runner memilih RPC berdasarkan `runNumber`:

```text
rpcIndex = (runNumber - 1) mod jumlahRpc
```

Dengan empat RPC, distribusi room kira-kira merata:

```text
room 1 -> 8545
room 2 -> 8546
room 3 -> 8547
room 4 -> 8548
room 5 -> 8545
...
```

Tujuannya adalah menghindari semua request masuk ke satu endpoint RPC saja.

### 10.5 Preflight RPC Health per Wave

Sebelum wave dijalankan, runner mengecek endpoint RPC yang akan dipakai wave tersebut. Pada preset balanced:

```text
STRESS_PREFLIGHT_RPC_HEALTH_REQUIRE_ALL=true
```

Artinya semua RPC yang dipakai pada wave harus sehat. Health-check membaca:

1. Block number.
2. Statistik txpool melalui `txpool_besuStatistics`.

Jika RPC belum sehat, runner menunggu hingga timeout preflight.

### 10.6 Stagger Launch di Dalam Wave

Walaupun dua room berada dalam wave yang sama, launch tidak selalu terjadi pada milidetik yang sama. Runner memberi random delay dalam jendela:

```text
0 sampai 8000 ms
```

Tujuan stagger:

1. Menghindari spike buatan yang terlalu tajam.
2. Mensimulasikan TPS yang mengirim hampir bersamaan tetapi tidak identik waktunya.
3. Mengurangi risiko bottleneck lokal pada RPC dan Node.js child process.

### 10.7 Eksekusi Room

Setiap room dijalankan sebagai child process Hardhat:

```powershell
hardhat run scripts/run-room-test.js --network besu
```

Environment yang dikirim ke child process:

| Env | Nilai |
|---|---|
| `ROOM_MODE` | `new` |
| `ROOM_NAME` | Nama unik berdasarkan stage dan run number |
| `VOTE_MODE` | `concurrent` |
| `ACCOUNT_OFFSET` | Offset akun berdasarkan slot |
| `VOTER_COUNT` | `30` |
| `RESULT_PATH` | Path JSON detail room |
| `VOTE_RUN_TIMEOUT_MS` | `240000` |
| `BESU_RPC_URL` | RPC endpoint yang dialokasikan |
| `RPC_ENDPOINT_LABEL` | Label RPC, misalnya `rpc-1` |

### 10.8 Alur per Room

Di dalam `run-room-test.js`, satu room menjalankan alur:

1. Load 30 EOA berdasarkan `ACCOUNT_OFFSET`.
2. EOA pertama menjadi admin room.
3. Fund EOA jika diperlukan.
4. Load atau deploy system contract.
5. Buat room baru melalui `RoomFactory.createRoom`.
6. Set `VotingResultCenter` jika diperlukan.
7. Tambahkan 30 voter dengan `addVoters(address[])`.
8. Tambahkan 3 candidate dengan `addCandidates(uint256[], string[])`.
9. Start room dengan `start()`.
10. Kirim 30 vote secara concurrent.
11. Tunggu receipt vote dengan concurrency terbatas.
12. Stop room dengan `stop()`.
13. Inspect hasil on-chain.
14. Reconcile failed row dengan state contract.
15. Submit history ke `VotingResultCenter`.
16. Simpan result JSON room.

### 10.9 Pengiriman Vote Concurrent

Dalam satu room:

```text
30 voter -> 30 transaksi vote() dikirim hampir bersamaan
```

Candidate dibagi secara deterministik:

```text
voter 1 -> candidate 1
voter 2 -> candidate 2
voter 3 -> candidate 3
voter 4 -> candidate 1
...
```

Karena ada 30 voter dan 3 candidate, jika semua sukses maka distribusi ideal:

```text
candidate 1 = 10 vote
candidate 2 = 10 vote
candidate 3 = 10 vote
totalVotes = 30
eventCount = 30
```

### 10.10 Receipt Waiting

Setelah submit vote, script menunggu receipt dengan concurrency terbatas:

```text
RECEIPT_WAIT_CONCURRENCY default = 6
```

Tujuannya adalah menghindari polling receipt yang terlalu agresif terhadap RPC lokal.

### 10.11 Retry dan Recovery

Jika submit vote gagal karena error sementara, script melakukan retry. Error yang dianggap transient antara lain:

1. `other side closed`
2. `socket hang up`
3. `ECONNRESET`
4. `ETIMEDOUT`
5. timeout koneksi
6. internal RPC error
7. nonce terlalu rendah atau nonce sudah dipakai, jika `VOTE_RETRY_NONCE_ERRORS=true`

Sebelum retry, script menjalankan health-check. Retry dilanjutkan jika RPC kembali sehat.

Nonce dikurangi risikonya dengan:

```text
VOTE_USE_PENDING_NONCE=true
```

Artinya nonce vote diambil dari pending state, bukan hanya latest mined state.

### 10.12 Final Reconciliation

Dalam sistem RPC, ada kemungkinan transaksi sebenarnya sudah masuk chain, tetapi response RPC gagal diterima oleh client. Untuk mencegah false negative, script melakukan final reconciliation:

```text
lastVotedRound[voter] == currentRound
```

Jika state contract menunjukkan voter sudah vote pada round tersebut, row yang semula gagal dapat dipulihkan sebagai sukses dengan flag:

```text
confirmedByContractState
recoveredByFinalReconciliation
```

Pendekatan ini penting untuk menjaga validitas data karena sumber kebenaran akhir adalah state on-chain, bukan hanya response HTTP/RPC.

### 10.13 Dynamic Wave Delay

Setelah wave selesai, runner menghitung ringkasan wave:

1. Apakah ada process room gagal.
2. Apakah ada vote gagal.
3. Apakah ada failed health probe.
4. Total health wait.
5. Total submit retry.

Jika wave bermasalah, base delay antar-wave dinaikkan. Jika wave stabil dan tidak ada retry, base delay diturunkan.

Aturan balanced:

```text
min delay = 10000 ms
max delay = 30000 ms
increase = 5000 ms
decrease = 2000 ms
jitter = 0 sampai 5000 ms
```

Tujuannya adalah membuat eksperimen adaptif terhadap kondisi RPC tanpa menghilangkan karakter stress test.

## 11. Output Eksperimen

Hasil eksperimen ditulis ke:

```text
v5\evaluation-solidity\results
```

Folder hasil memiliki format:

```text
results\stage-5-tps-stress-main-YYYYMMDD-HHmmss
```

Isi utama:

| File | Isi |
|---|---|
| `sampling-stage-5-tps-stress-main-*.json` | Aggregate result seluruh eksperimen. |
| `summary.md` | Ringkasan hasil utama dalam Markdown. |
| `summary-rooms.csv` | Satu baris per room/TPS. Cocok untuk Excel/statistik. |
| `summary-waves.csv` | Satu baris per wave. Cocok untuk analisis batch. |
| `room-vote-*.json` | Detail hasil satu room/TPS. |

`sampling-stage-*.json` adalah sumber data paling lengkap untuk analisis penelitian.

## 12. Metrik Penelitian

### 12.1 Metrik Completeness

| Metrik | Definisi |
|---|---|
| `expectedVoteTransactions` | Target transaksi vote, yaitu `390 x 30 = 11.700`. |
| `totals.successCount` | Jumlah vote yang dinilai sukses oleh script. |
| `totals.failedVoteCount` | Jumlah vote yang gagal setelah retry/recovery. |
| `totals.totalVotesOnChain` | Jumlah vote yang tersimpan di smart contract. |
| `totals.eventCount` | Jumlah event `VoteCast` yang ditemukan. |
| `totals.failedProcessRoomCount` | Jumlah child process room yang gagal. |
| `totals.timeoutRunCount` | Jumlah room yang melewati timeout vote run. |

Kondisi ideal:

```text
successCount = expectedVoteTransactions
failedVoteCount = 0
totalVotesOnChain = expectedVoteTransactions
eventCount = expectedVoteTransactions
failedProcessRoomCount = 0
timeoutRunCount = 0
```

### 12.2 Metrik Reliability

| Metrik | Definisi |
|---|---|
| `retryTotals.totalSubmitRetries` | Total retry submit vote. |
| `retryTotals.votesWithRetry` | Jumlah vote yang butuh retry. |
| `retryTotals.votesRecoveredAfterRetry` | Vote yang berhasil setelah retry. |
| `retryTotals.failedAfterRetries` | Vote yang tetap gagal setelah retry. |
| `retryTotals.confirmedByContractStateCount` | Vote yang dikonfirmasi sukses dari state contract. |
| `retryTotals.recoveredByFinalReconciliationCount` | Vote yang dipulihkan saat final reconciliation. |
| `retryTotals.healthCheckCount` | Jumlah health-check sebelum retry. |
| `retryTotals.failedHealthProbeCount` | Jumlah probe RPC gagal. |
| `retryTotals.healthWaitSeconds` | Total waktu tunggu health-check. |

Reliability dapat dijelaskan melalui:

```text
successRate = successCount / expectedVoteTransactions x 100%
failureRate = failedVoteCount / expectedVoteTransactions x 100%
recoveryRate = votesRecoveredAfterRetry / votesWithRetry x 100%
```

### 12.3 Metrik Latency

| Metrik | Definisi |
|---|---|
| `averages.avgSuccessfulAttemptLatencyMs` | Rata-rata waktu dari tx hash diterima sampai receipt confirm pada attempt yang sukses. |
| `averages.avgTotalVoteElapsedMs` | Rata-rata waktu dari attempt pertama sampai hasil akhir vote, termasuk retry. |
| `averages.avgRetryRecoveryElapsedMs` | Rata-rata durasi recovery untuk vote yang mengalami retry. |
| `latencyPercentiles.p50` | Median latency. |
| `latencyPercentiles.p90` | Latency yang mencakup 90% vote. |
| `latencyPercentiles.p95` | Latency yang mencakup 95% vote. |
| `latencyPercentiles.p99` | Latency tail untuk 99% vote. |

Perbedaan penting:

```text
avgSuccessfulAttemptLatencyMs
  -> mengukur performa transaksi yang akhirnya sukses.

avgTotalVoteElapsedMs
  -> mengukur pengalaman end-to-end, termasuk retry dan health wait.
```

### 12.4 Metrik Gas

| Metrik | Definisi |
|---|---|
| `totals.totalGasUsed` | Total gas untuk vote transaction yang sukses. |
| `averages.avgGasUsed` | Rata-rata gas per vote transaction sukses. |

Karena private network menggunakan gas price 0, gas dalam penelitian ini lebih tepat dibaca sebagai ukuran kompleksitas eksekusi EVM, bukan biaya ekonomi.

### 12.5 Metrik RPC Distribution

`rpcSummary` menunjukkan beban per endpoint:

```text
runCount
successCount
failedCount
totalVotesOnChain
totalSubmitRetries
failedHealthProbeCount
```

Jika salah satu RPC memiliki retry atau health probe gagal jauh lebih tinggi, hal itu dapat menjadi indikasi endpoint tersebut lebih berat atau kurang stabil.

### 12.6 Metrik Storage

Aggregate JSON menyimpan snapshot ukuran folder data node:

```text
storage.before
storage.after
```

Metrik ini dapat dipakai untuk melihat pertumbuhan storage node setelah eksperimen.

## 13. Validasi On-Chain

Validasi tidak hanya dilakukan berdasarkan status transaksi. Script melakukan tiga jenis validasi:

1. **Receipt validation**: receipt transaksi harus memiliki `status = 1`.
2. **State validation**: `roundTotalVotes(roundId)` dan `getVotes(roundId, candidateId)` dibaca langsung dari contract.
3. **Event validation**: event `VoteCast` dihitung dari log contract.

Kondisi valid yang kuat:

```text
successCount == totalVotesOnChain == eventCount == expectedVoteTransactions
```

Jika `successCount` tinggi tetapi `totalVotesOnChain` lebih rendah, maka ada inkonsistensi antara data client dan state contract. Jika `totalVotesOnChain` tinggi tetapi `eventCount` rendah, maka ada kemungkinan query event kurang lengkap atau batas block range bermasalah. Jika event dan state sama, hasil lebih kuat untuk dipakai sebagai bukti penelitian.

## 14. Rancangan Sampling

Unit sampel penelitian adalah TPS room:

```text
sampleUnit = tps-room
```

Jumlah sampel:

```text
targetSampleTps = 390
```

Setiap sampel TPS room memiliki 30 voter dan 3 candidate. Dengan demikian, setiap TPS menghasilkan 30 transaksi vote. Pengujian ini bukan random sampling pemilih dari populasi manusia, melainkan workload sampling berbasis simulasi untuk mengukur perilaku sistem.

Populasi acuan pada runner:

```text
populationTps = 3000
```

Target sampel 390 TPS dapat dipandang sebagai subset workload yang cukup besar untuk mengamati kestabilan sistem pada beban berulang. Karena eksperimen dilakukan di lingkungan lokal terkontrol, generalisasi hasil harus dibatasi pada konfigurasi hardware, Docker, Besu, dan parameter eksperimen yang sama atau mirip.

## 15. Alur Data dari Transaksi sampai Result

Alur data:

```text
EOA voter
  -> vote(candidateId)
  -> RPC endpoint Besu
  -> txpool
  -> QBFT consensus
  -> block finalized
  -> VotingRoom state updated
  -> VoteCast event emitted
  -> receipt read by script
  -> inspect round
  -> result JSON per room
  -> aggregate JSON + CSV + summary.md
```

Data yang disimpan per vote:

1. Voter address.
2. Candidate id.
3. Tx hash.
4. Receipt status.
5. Block number.
6. Gas used.
7. Latency.
8. Submit attempts.
9. Retry count.
10. Failure reason jika ada.
11. Health-check detail jika retry.
12. Flag reconciliation jika dipulihkan dari state contract.

## 16. Cara Membaca Hasil

Setelah command selesai, buka folder result terakhir:

```text
v5\evaluation-solidity\results\stage-5-tps-stress-main-YYYYMMDD-HHmmss
```

Mulai dari:

```text
summary.md
```

Field utama yang harus dicek:

```text
TPS rooms: 390
Parallel rooms per wave: 2
Expected vote transactions: 11700
Success count
Failed vote count
On-chain votes
Event count
Elapsed
Avg successful attempt latency
Avg total vote elapsed
Total submit retries
Health wait seconds
```

Interpretasi dasar:

| Kondisi | Interpretasi |
|---|---|
| `Success count = 11700` | Semua vote berhasil menurut script. |
| `Failed vote count = 0` | Tidak ada vote final yang gagal. |
| `On-chain votes = 11700` | Semua vote benar-benar tercatat di contract. |
| `Event count = 11700` | Semua vote menghasilkan event yang dapat dibaca. |
| `Total submit retries > 0` | Ada error sementara, tetapi belum tentu gagal final. |
| `Health wait seconds > 0` | Script sempat menunggu RPC sehat sebelum retry. |
| `Confirmed by contract state > 0` | Ada response/receipt bermasalah, tetapi state contract membuktikan vote sudah masuk. |

Untuk analisis statistik, gunakan:

```text
summary-rooms.csv
summary-waves.csv
```

Untuk audit satu TPS tertentu, buka:

```text
room-vote-*.json
```

## 17. Contoh Rumus Analisis

Success rate:

```text
successRate = successCount / expectedVoteTransactions x 100%
```

Failure rate:

```text
failureRate = failedVoteCount / expectedVoteTransactions x 100%
```

On-chain completeness:

```text
onChainCompleteness = totalVotesOnChain / expectedVoteTransactions x 100%
```

Event completeness:

```text
eventCompleteness = eventCount / expectedVoteTransactions x 100%
```

Retry ratio:

```text
retryRatio = votesWithRetry / expectedVoteTransactions x 100%
```

Average submit retries per vote:

```text
averageSubmitRetriesPerVote = totalSubmitRetries / expectedVoteTransactions
```

Recovery rate:

```text
recoveryRate = votesRecoveredAfterRetry / votesWithRetry x 100%
```

Jika `votesWithRetry = 0`, recovery rate tidak perlu dihitung karena tidak ada vote yang membutuhkan recovery.

## 18. Kriteria Keberhasilan Eksperimen

Eksperimen balanced dapat dianggap berhasil secara fungsional jika:

1. Semua 390 room selesai tanpa child process crash.
2. Semua 11.700 vote tercatat sukses atau terbukti sukses melalui contract state.
3. `failedVoteCount = 0`.
4. `totalVotesOnChain = 11.700`.
5. `eventCount = 11.700`.
6. Setiap room memiliki `totalVotesOnChain = 30`.
7. Tidak ada room yang timeout.

Eksperimen dapat dianggap berhasil secara reliabilitas jika:

1. Retry yang terjadi dapat dipulihkan.
2. `failedAfterRetries = 0`.
3. RPC health-check tidak menunjukkan endpoint yang terus gagal.
4. Dynamic wave delay mampu menjaga wave berikutnya tetap stabil.

Eksperimen dapat dianggap berhasil secara performa jika:

1. Latency rata-rata dan percentile masih berada dalam batas yang dapat diterima untuk konteks aplikasi e-voting.
2. Tail latency, terutama p95 dan p99, tidak menunjukkan lonjakan ekstrem yang berulang.
3. Throughput workload selesai dalam durasi yang konsisten antar-run.

## 19. Kontrol Eksperimen

Untuk menjaga reproducibility, kondisi berikut sebaiknya dicatat:

1. Tanggal dan jam eksperimen.
2. Spesifikasi perangkat, terutama CPU, RAM, dan storage.
3. Versi Docker Desktop.
4. Image Besu yang digunakan.
5. Versi Node.js dan npm.
6. Jumlah validator aktif.
7. Isi parameter balanced.
8. Apakah chain baru di-reset sebelum eksperimen.
9. Apakah deployment contract baru atau reuse.
10. Jumlah EOA dalam `accounts\eoa-collections.json`.
11. Apakah ada aplikasi berat lain berjalan di host.

Sebelum menjalankan eksperimen final, disarankan:

```powershell
docker ps
npm run network:check
```

Dan setelah selesai, simpan folder result secara utuh karena file aggregate, CSV, dan room detail saling melengkapi.

## 20. Ancaman Validitas

### 20.1 Validitas Internal

Kemungkinan faktor yang memengaruhi hasil:

1. Beban CPU/RAM host dari aplikasi lain.
2. Docker Desktop throttling.
3. Kondisi storage lokal.
4. RPC endpoint overload.
5. Node.js child process scheduling.
6. Chain data yang sudah besar akibat eksperimen sebelumnya.

Mitigasi:

1. Jalankan eksperimen pada kondisi perangkat stabil.
2. Tutup aplikasi berat.
3. Gunakan preset balanced atau light untuk perangkat terbatas.
4. Jalankan `network:check` sebelum eksperimen.
5. Reset chain jika ingin menghilangkan efek histori chain.

### 20.2 Validitas Eksternal

Hasil eksperimen berasal dari private network lokal 4 validator. Karena itu, hasil tidak boleh langsung digeneralisasi ke:

1. Public blockchain.
2. Jaringan geografis multi-region.
3. Validator dengan latensi internet nyata.
4. Hardware server produksi.
5. Jumlah TPS nasional yang jauh lebih besar tanpa pengujian tambahan.

Namun, hasil valid untuk menunjukkan perilaku sistem pada private blockchain lokal dengan QBFT dan topologi 4 validator.

### 20.3 Validitas Konstruk

Istilah TPS dalam eksperimen berarti Tempat Pemungutan Suara. Karena itu, `390 TPS` berarti 390 room simulasi, bukan 390 transaksi per detik. Untuk menghindari salah tafsir, laporan penelitian harus membedakan:

```text
TPS = Tempat Pemungutan Suara
tx/s = transaction per second
```

### 20.4 Validitas Kesimpulan

Kesimpulan sebaiknya didasarkan pada beberapa run, bukan hanya satu run. Jika memungkinkan, jalankan preset balanced beberapa kali dan bandingkan:

1. Success rate.
2. On-chain completeness.
3. Retry ratio.
4. Average latency.
5. p95 dan p99 latency.
6. Durasi total eksperimen.

## 21. Limitasi Eksperimen

Limitasi utama:

1. Semua node berjalan pada satu host fisik, sehingga resource contention berbeda dari deployment multi-server.
2. Network latency antar-node Docker bridge jauh lebih rendah daripada jaringan nyata.
3. Gas price 0 menghilangkan dinamika fee market.
4. Jumlah candidate tetap 3.
5. Jumlah voter per TPS tetap 30.
6. Beban vote difokuskan pada transaksi `vote()`, sementara transaksi administrasi room juga terjadi tetapi bukan unit metrik utama.
7. EOA dapat dipakai ulang antar-wave karena model penelitian menekankan isolasi per room, bukan identitas voter global lintas TPS.

## 22. Template Narasi Metodologi untuk Laporan

Narasi yang dapat digunakan dalam laporan:

```text
Pengujian dilakukan pada jaringan private blockchain Hyperledger Besu dengan konsensus QBFT yang terdiri dari empat validator. Setiap validator dijalankan sebagai container Docker dan menyediakan endpoint RPC lokal. Sistem e-voting direpresentasikan oleh tiga kontrak utama, yaitu RoomFactory, VotingRoom, dan VotingResultCenter. Satu TPS dimodelkan sebagai satu VotingRoom, satu pemilih dimodelkan sebagai satu EOA, dan satu suara dimodelkan sebagai satu transaksi vote().

Metode sampling yang digunakan adalah workload sampling berbasis TPS room. Pengujian balanced menjalankan 390 TPS simulasi, dengan 30 voter pada setiap TPS sehingga total target transaksi vote adalah 11.700 transaksi. Pengujian dilakukan secara staggered-parallel, yaitu dua TPS room berjalan paralel dalam setiap wave dan setiap room mengirim 30 transaksi vote secara concurrent. Dengan demikian, terdapat 195 wave pengujian.

Untuk meningkatkan stabilitas dan observabilitas, pengujian menggunakan empat endpoint RPC, preflight RPC health-check, retry untuk transient error dan nonce error, pending nonce, dynamic wave delay, serta final reconciliation terhadap state smart contract. Hasil akhir divalidasi melalui tiga sumber on-chain, yaitu receipt transaksi, state contract, dan event VoteCast. Metrik yang dianalisis mencakup success rate, failed vote count, on-chain completeness, event completeness, latency, gas usage, retry count, health wait, dan distribusi hasil per RPC endpoint.
```

## 23. Checklist Eksekusi

Gunakan checklist berikut sebelum mengambil data final:

```text
[ ] Docker Desktop berjalan.
[ ] File v5\.env memiliki BOOTNODE_URL.
[ ] Network Besu dijalankan dengan docker compose -f .\docker-compose.yml up -d.
[ ] Empat container validator aktif.
[ ] npm install sudah dilakukan di v5\evaluation-solidity.
[ ] Contract berhasil compile.
[ ] accounts\eoa-collections.json tersedia.
[ ] Jumlah EOA minimal 60 untuk balanced, disarankan 150 untuk fleksibilitas.
[ ] npm run network:check berhasil.
[ ] deployments\room-system.json tersedia atau redeploy sudah dilakukan.
[ ] Command npm run sampling:tps-stress-main:balanced dijalankan dari folder v5\evaluation-solidity.
[ ] Folder result disimpan setelah eksperimen selesai.
```

## 24. Ringkasan Parameter Final Balanced

Ringkasan inti:

```text
Command: npm run sampling:tps-stress-main:balanced
Stage ID: stage-5-tps-stress-main
Test type: staggered-parallel-tps
Sample unit: tps-room
Consensus: QBFT
Validator count: 4
Chain ID: 1337
Block period: 2 seconds
TPS room count: 390
Parallel room per wave: 2
Wave count: 195
Voter per room: 30
Candidate per room: 3
Expected vote transaction: 11.700
Vote mode: concurrent
RPC endpoint count: 4
Dynamic wave delay: enabled
Retry/recovery: enabled
Final reconciliation: enabled
Vote run timeout per room: 240.000 ms
```

Dokumen ini dapat digunakan sebagai basis penjelasan metodologi penelitian untuk eksperimen stress sampling TPS balanced pada sistem e-voting berbasis Besu QBFT.

