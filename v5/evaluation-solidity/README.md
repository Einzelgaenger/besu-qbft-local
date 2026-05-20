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
accounts\eoa-collections.json
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
- EOA pertama di `accounts\eoa-collections.json` harus sama dengan `roomAdmin`
- jika room masih `Active`, script otomatis memanggil `stop()` dulu
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

Jika room existing masih `Active`, script otomatis menjalankan `stop()` dari admin, lalu lanjut prepare room.

Jika room `Inactive` tetapi `roundReadyToStart = false`, script default menjalankan `reset()`. Ini cocok untuk testing ulang karena voter/candidate lama memang akan dibersihkan lalu diganti dengan 30 EOA dan 3 candidate baru.

Untuk mengganti perilaku:

```powershell
$env:ROOM_REUSE_ACTION="reset"    # default, clear voter/candidate lama dan round baru
$env:ROOM_REUSE_ACTION="restart"  # round baru, lalu script tetap clear voter/candidate lama
$env:ROOM_REUSE_ACTION="error"    # berhenti dan minta reset/restart manual
```

Pada mode existing, script akan cek state room dulu. Jika ready, script akan clear voter/candidate lama, lalu memasukkan 30 voter dan 3 candidate baru.

## 7. Jalankan Aksi Room Manual

Selain `npm run room:test`, tersedia command otomatis untuk menjalankan bagian tertentu dari flow room. Semua command memakai deployment system dari:

```text
deployments\room-system.json
```

Command ini cocok jika ingin menjalankan flow bertahap:

1. `reset()` room
2. masukkan 30 EOA sebagai voter
3. masukkan 3 candidate
4. kirim 30 vote dari 30 EOA
5. `start()` room otomatis jika room masih `Inactive` tetapi sudah ready
6. `stop()` room otomatis setelah vote selesai atau timeout

Admin room diambil dari `admin` pada file tersebut, lalu private key-nya dicari di `accounts\eoa-collections.json`. Jika admin tidak ada di file account, isi:

```powershell
$env:ADMIN_PRIVATE_KEY="0xPRIVATE_KEY_ADMIN_ROOM"
```

Parameter yang umum dipakai:

```text
ROOM_ADDRESS       address room VotingRoom yang akan dipakai
ADMIN_PRIVATE_KEY  private key admin room, hanya perlu jika admin tidak ada di accounts\eoa-collections.json
CANDIDATES         nama candidate dipisah koma, default Candidate A,B,C
CANDIDATE_IDS      id candidate dipisah koma, default 1,2,3
VOTE_MODE          concurrent atau sequential, default concurrent
VOTE_RUN_TIMEOUT_MS batas waktu total vote, default 60000
RECEIPT_WAIT_CONCURRENCY concurrency tunggu receipt vote, default 6
```

Reset room:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:reset
```

Tambah 30 voter dari `accounts\eoa-collections.json`:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:add-voter
```

Secara default command ini mengambil semua address dari:

```text
accounts\eoa-collections.json
```

Jika perlu override, bisa tetap kirim daftar voter manual:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:VOTERS="0xVOTER_1,0xVOTER_2,0xVOTER_3"
npm run room:add-voter
```

Tambah 3 candidate default dengan id `1`, `2`, dan `3`:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:add-candidate
```

Default candidate:

```text
1 = Candidate A
2 = Candidate B
3 = Candidate C
```

Jika perlu custom nama candidate:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:CANDIDATES="Ketua A,Ketua B,Ketua C"
npm run room:add-candidate
```

Start room saja:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:start
```

Jika room sudah `Active`, `room:start` tidak mengirim transaksi baru dan hanya menampilkan status saat ini. Jika room `Inactive` tetapi `roundReadyToStart=false` karena baru selesai `stop()`, `room:start` default menjalankan `restart()` dulu lalu `start()` agar voter/candidate lama tetap dipakai.

Untuk mengubah perilaku sebelum start:

```powershell
$env:ROOM_START_REUSE_ACTION="restart" # default, pakai voter/candidate lama
$env:ROOM_START_REUSE_ACTION="reset"   # clear voter/candidate, perlu add ulang sebelum start
$env:ROOM_START_REUSE_ACTION="error"   # berhenti jika belum ready
```

Stop room saja:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:stop
```

Jika room sudah `Inactive`, `room:stop` tidak mengirim transaksi baru dan hanya menampilkan status saat ini.

Kirim 30 vote dari 30 EOA ke 3 candidate:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:vote
```

Sebelum mengirim vote, `room:vote` akan mengecek status room:

- jika room `Active`, vote langsung dijalankan
- jika room `Inactive` dan `roundReadyToStart = true`, script otomatis memanggil `start()` lalu lanjut vote
- jika room `Inactive` dan `roundReadyToStart = false`, script mengikuti `ROOM_REUSE_ACTION`

Default `ROOM_REUSE_ACTION` adalah `reset`, sama seperti `room:test`:

```powershell
$env:ROOM_REUSE_ACTION="reset"    # default
$env:ROOM_REUSE_ACTION="restart"
$env:ROOM_REUSE_ACTION="error"
```

Jika `room:vote` menjalankan `reset()` atau `restart()`, script akan berhenti setelah aksi itu karena voter/candidate mungkin perlu disiapkan ulang. Lanjutkan lagi dengan `room:add-voter`, `room:add-candidate`, lalu ulangi `room:vote`.

Default vote:

- `VOTE_MODE=concurrent`
- `VOTE_RUN_TIMEOUT_MS=60000`
- candidate id yang dipakai `1,2,3`
- pembagian vote mengikuti urutan EOA: voter 1 ke candidate 1, voter 2 ke candidate 2, voter 3 ke candidate 3, lalu berulang
- jika room sudah ready tetapi belum active, script otomatis memanggil `start()` memakai admin room
- setelah vote selesai atau timeout, script otomatis memanggil `stop()` memakai admin room
- hasil vote ditulis ke `results\room-vote-manual-TIMESTAMP.json`

Vote sequential:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:VOTE_MODE="sequential"
npm run room:vote
```

Vote concurrent dengan timeout 30 detik:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:VOTE_MODE="concurrent"
$env:VOTE_RUN_TIMEOUT_MS="30000"
npm run room:vote
```

Jika ada transaksi yang belum mendapat receipt sampai timeout, script tidak berhenti tanpa hasil. Script akan menandai transaksi tersebut sebagai gagal/timeout, mengecek ulang receipt yang tersedia, mencoba `stop()` room, lalu tetap menulis file result ke folder `results`.

Semua command juga bisa memakai argumen npm untuk `ROOM_ADDRESS` dan opsi utama:

```powershell
npm run room:reset -- --room 0xROOM_ADDRESS
npm run room:add-voter -- --room 0xROOM_ADDRESS
npm run room:add-candidate -- --room 0xROOM_ADDRESS
npm run room:start -- --room 0xROOM_ADDRESS
npm run room:stop -- --room 0xROOM_ADDRESS
npm run room:vote -- --room 0xROOM_ADDRESS --vote-mode concurrent --candidate-ids 1,2,3
```

Catatan state kontrak:

- `room:reset` hanya bisa saat room `Inactive` dan `roundReadyToStart = false`.
- `room:add-candidate` hanya bisa saat room `Inactive`.
- `room:add-voter` dikirim dalam satu batch `addVoters(address[])`.
- `room:add-candidate` default dikirim dalam satu batch `addCandidates(uint256[],string[])`.
- `room:start` menjalankan `start()`; jika room belum ready karena round sebelumnya sudah `stop()`, default menjalankan `restart()` dulu.
- `room:stop` hanya menjalankan `stop()` dan bisa dipakai jika ingin menutup round aktif tanpa menjalankan vote.
- `room:vote` hanya bisa saat room `Active`, 30 EOA sudah terdaftar, candidate valid, dan setiap EOA belum vote pada round berjalan.
- Jika room belum `Active` tetapi sudah ready, `room:vote` otomatis menjalankan `start()`, jadi `room:start` bersifat opsional.
- `room:vote` otomatis memanggil `stop()` setelah proses vote selesai atau timeout. Transaksi stop dicatat di field `stopAfterVote` pada result.

## 8. Apa Yang Terjadi Saat Semua Vote Bersamaan

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

## 9. Vote Mode

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

## 10. Timeout Voting Dan Result Parsial

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

Untuk command manual seperti `room:reset`, `room:add-voter`, `room:add-candidate`, `room:start`, `room:stop`, dan auto admin tx di `room:vote`, script memberi buffer gas pada estimasi gas admin. Default buffer:

```text
ADMIN_GAS_BUFFER_PERCENT=130
```

Jika transaksi admin masuk block tetapi `status=0`, biasanya gas limit terlalu kecil atau kontrak revert. Untuk memaksa gas limit admin yang lebih besar:

```powershell
$env:ADMIN_GAS_LIMIT="5000000"
npm run room:stop
```

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

## 11. File Result

Setiap run membuat file:

```text
results\room-vote-TIMESTAMP.json
```

Untuk `npm run room:vote` pada flow manual, file result dibuat dengan nama:

```text
results\room-vote-manual-TIMESTAMP.json
```

Result manual juga mencatat field `stopAfterVote` untuk status transaksi `stop()` otomatis.

Isi utama:

- room address
- room name
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

## 12. Inspect Room

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

## 13. Fault Tolerance Testing

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

## 14. Audit Consistency

Untuk audit, bandingkan:

- `totalVotes` dari `VotingRoom.roundTotalVotes(roundId)`
- event count `VoteCast`
- vote per candidate dari `VotingRoom.getVotes(roundId, candidateId)`
- history yang dipublish ke `VotingResultCenter`, jika kompatibel dengan factory lokal

Data on-chain dari script dianggap source of truth. Dashboard atau aplikasi harus mengikuti hasil on-chain ini.
