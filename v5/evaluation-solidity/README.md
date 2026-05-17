# V5 Voting Room Evaluation

Folder ini dipakai untuk menguji kontrak `v5`:

- `VotingRoom`
- `RoomFactory`
- `VotingResultCenter`

Perbedaan utama dari `v3`: testing memakai 30 EOA berbeda, room bisa dibuat baru atau memakai room existing, dan vote bisa dikirim dengan mode `concurrent` atau `sequential`. Jika `VOTE_MODE` tidak diisi, default-nya adalah `concurrent`.

## 1. Jalankan Besu QBFT

Gunakan network yang disiapkan di `besu-qbft-local\v5`. Jika network belum pernah dibuat, ikuti dulu panduan:

```text
..\SETUP-BESU-QBFT-FROM-ZERO.md
```

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
docker compose up -d
docker ps
```

RPC:

- Node 1: `http://127.0.0.1:8545`
- Node 2: `http://127.0.0.1:8546`
- Node 3: `http://127.0.0.1:8547`
- Node 4: `http://127.0.0.1:8548`

Stop network:

```powershell
docker compose down
```

## 2. Setup Evaluasi V5

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5\evaluation-solidity
npm install
npm run compile
```

Default deployer/funder memakai private key dari `v3\address-private-key.txt`.

Jika ingin override RPC atau private key:

```powershell
$env:BESU_RPC_URL="http://127.0.0.1:8545"
$env:PRIVATE_KEY="0xPRIVATE_KEY_FUNDER"
```

## 3. Generate 30 EOA

```powershell
npm run generate:eoa
```

Output:

```text
accounts\eoa-30.json
```

EOA pertama otomatis menjadi admin room pada testing ini. Semua 30 EOA akan didaftarkan sebagai voter.

## 4. Network Testing

```powershell
npm run network:check
```

Ekspektasi:

- chain id `1337`
- node 1 punya sekitar 3 peer saat 4 node hidup
- block number bertambah
- validator QBFT muncul dari method `qbft_getValidatorsByBlockNumber`

Untuk cek block naik manual:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

## 5. Testing Room Baru

Mode ini akan:

1. fund 30 EOA dari deployer
2. deploy `VotingRoom` implementation, `RoomFactory`, dan `VotingResultCenter` jika belum ada
3. buat room baru lewat `RoomFactory`
4. set EOA pertama sebagai room admin
5. masukkan 30 EOA sebagai voter
6. masukkan 3 candidate
7. start round
8. kirim 30 vote bersamaan
9. stop round
10. simpan hasil ke `results`

```powershell
$env:ROOM_MODE="new"
npm run room:test
```

Custom nama room dan kandidat:

```powershell
$env:ROOM_MODE="new"
$env:ROOM_NAME="Room Evaluasi Skripsi"
$env:CANDIDATES="Candidate A,Candidate B,Candidate C"
npm run room:test
```

Deployment system disimpan di:

```text
deployments\room-system.json
```

Untuk force redeploy system:

```powershell
$env:REDEPLOY_SYSTEM="true"
$env:ROOM_MODE="new"
npm run room:test
```

## 6. Testing Existing Room

Mode ini meminta room address yang sudah ada.

Syarat:

- room harus memakai kontrak `VotingRoom` v5
- EOA pertama di `accounts\eoa-30.json` harus sama dengan `roomAdmin`
- room harus `Inactive`
- jika `roundReadyToStart = false`, script default akan memanggil `reset()` agar room siap dipakai lagi

Jalankan interaktif:

```powershell
$env:ROOM_MODE="existing"
npm run room:test
```

Atau langsung lewat env:

```powershell
$env:ROOM_MODE="existing"
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:test
```

Jika room existing masih `Active`, stop dulu dari admin.

Jika room `Inactive` tetapi `roundReadyToStart = false`, script default menjalankan `reset()`. Ini cocok untuk testing ulang karena voter/candidate lama memang akan dibersihkan lalu diganti dengan 30 EOA dan 3 candidate baru.

Untuk mengganti perilaku:

```powershell
$env:ROOM_REUSE_ACTION="reset"    # default, clear voter/candidate lama dan round baru
$env:ROOM_REUSE_ACTION="restart"  # round baru, lalu script tetap clear voter/candidate lama
$env:ROOM_REUSE_ACTION="error"    # berhenti dan minta reset/restart manual
```

Pada mode existing, script akan cek state room dulu. Jika ready, script akan clear voter/candidate lama, lalu memasukkan 30 voter dan 3 candidate baru.

## 7. Apa Yang Terjadi Saat Semua Vote Bersamaan

Script mengirim 30 transaksi `vote()` secara paralel dari 30 EOA berbeda. Setelah semua transaksi terkirim ke RPC, script menunggu receipt dengan concurrency terbatas agar RPC Besu lokal tidak mudah memutus koneksi saat polling receipt.

Ekspektasi:

- Besu menerima transaksi secara bersamaan ke tx pool.
- Karena tiap EOA punya nonce masing-masing, tidak ada konflik nonce antar voter.
- Kontrak tetap dieksekusi satu per satu dalam urutan block/transaction.
- Semua vote harus sukses selama room `Active`, voter terdaftar, candidate valid, dan setiap EOA hanya vote sekali.
- Hasil akhir seharusnya `totalVotes = 30` dan `eventCount = 30`.

Jika ada transaksi gagal, file result akan mencatat `failedCount`, address voter, candidate id, dan error.

Jika RPC lokal masih terlalu berat, turunkan concurrency polling receipt:

```powershell
$env:RECEIPT_WAIT_CONCURRENCY="3"
npm run room:test
```

## 7A. Vote Mode

Script mendukung dua mode pengiriman vote:

```powershell
$env:VOTE_MODE="concurrent"
```

`concurrent` adalah default. Semua voter mengirim transaksi hampir bersamaan. Pada mode ini log terminal bisa tidak urut, misalnya `Vote 18/30` muncul sebelum `Vote 16/30`, karena transaksi dan receipt diproses paralel oleh RPC, node, dan script.

```powershell
$env:VOTE_MODE="sequential"
```

`sequential` mengirim vote satu per satu. Script menunggu receipt vote pertama sebelum mengirim vote kedua, dan seterusnya sampai 30. Mode ini lebih mudah dibaca di terminal, tetapi total waktu test biasanya lebih lama.

Contoh menjalankan room baru dengan sequential vote:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="sequential"
npm run room:test
```

Contoh menjalankan room baru dengan concurrent vote:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="concurrent"
npm run room:test
```

Jika `VOTE_MODE` tidak di-set, script memakai default:

```text
concurrent
```

## 7B. Timeout Voting Dan Result Parsial

Untuk fault tolerance test, script memiliki batas waktu total proses voting:

```text
VOTE_RUN_TIMEOUT_MS=60000
```

Default `60000 ms` berarti 60 detik. Jika vote run melewati batas ini, script akan:

- berhenti menunggu receipt vote yang belum selesai
- pada mode `sequential`, berhenti mengirim vote berikutnya
- menandai vote yang tidak selesai sebagai gagal atau `skipped`
- tetap mencoba memanggil `stop()` pada room
- tetap inspect hasil on-chain yang sudah masuk
- tetap menyimpan file result ke folder `results`

Metrics seperti `successCount`, `failedCount`, `avgLatencyMs`, `avgGasUsed`, dan `totalGasUsed` dihitung dari transaksi yang benar-benar sukses. Jadi kalau hanya 18 dari 30 vote sukses sebelum timeout, average latency dan average gas dihitung dari 18 transaksi sukses tersebut.

Untuk mengubah batas timeout:

```powershell
$env:VOTE_RUN_TIMEOUT_MS="30000"   # 30 detik
npm run room:test
```

Transaksi admin seperti `reset()`, `addVoters()`, `start()`, dan `stop()` juga punya timeout receipt:

```text
ADMIN_TX_TIMEOUT_MS=120000
```

Default `120000 ms` berarti 120 detik. Jika script terlihat berhenti di `reset()` atau `start()`, biasanya script sedang menunggu receipt transaksi admin tersebut. Script akan mencetak tx hash dan berhenti dengan error jika melewati timeout ini.

Untuk mengubahnya:

```powershell
$env:ADMIN_TX_TIMEOUT_MS="60000"
npm run room:test
```

Contoh fault tolerance dengan timeout lebih pendek:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="concurrent"
$env:VOTE_RUN_TIMEOUT_MS="30000"
npm run room:test
```

## 8. File Result

Setiap run membuat file:

```text
results\room-vote-TIMESTAMP.json
```

Isi utama:

- room address
- admin
- daftar candidate
- daftar 30 EOA yang difund
- transaksi prepare room
- transaksi start/stop
- semua tx hash vote
- latency per voter
- min/max/average latency
- gas used per vote
- total dan average gas used untuk vote yang sukses
- timeout status dari `voteRun.timeoutExceeded`
- total vote on-chain
- event count `VoteCast`
- hasil per candidate
- status submit history ke `VotingResultCenter`

Bagian hasil vote utama ada di `voteRun`. Untuk kompatibilitas pembacaan lama, script juga menulis alias:

- `concurrentVoting` jika `VOTE_MODE=concurrent`
- `sequentialVoting` jika `VOTE_MODE=sequential`

## 9. Inspect Room

Cek hasil round tertentu:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:ROUND_ID="1"
npm run room:inspect
```

Output menampilkan:

- current room status
- total votes round yang diinspeksi
- event count
- voter count
- vote per candidate
- latest published version di `VotingResultCenter` jika deployment lokal tersedia

## 10. Fault Tolerance Testing

Dengan 4 validator QBFT, jaringan idealnya masih jalan saat 1 validator mati.

Baseline:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Matikan 1 validator:

```powershell
docker stop besu-v5-node4
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Ekspektasi: block tetap naik.

Matikan validator kedua:

```powershell
docker stop besu-v5-node3
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":3}'
```

Ekspektasi: 4-node QBFT biasanya tidak bisa finalize jika 2 validator mati.

Nyalakan kembali:

```powershell
docker start besu-v5-node3
docker start besu-v5-node4
```

## 11. Audit Consistency

Untuk audit, bandingkan:

- `totalVotes` dari `VotingRoom.roundTotalVotes(roundId)`
- event count `VoteCast`
- vote per candidate dari `VotingRoom.getVotes(roundId, candidateId)`
- history yang dipublish ke `VotingResultCenter`, jika kompatibel dengan factory lokal

Data on-chain dari script dianggap source of truth. Dashboard atau aplikasi harus mengikuti hasil on-chain ini.
