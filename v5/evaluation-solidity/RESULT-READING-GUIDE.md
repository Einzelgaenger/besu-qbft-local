# Panduan Membaca Result Voting Room V5

Dokumen ini menjelaskan cara membaca hasil:

```text
results\room-vote-1778988541056.json
```

Dokumen ini juga menjelaskan bagaimana sistem testing di `v5\evaluation-solidity` bekerja saat ini.

## 1. Ringkasan Hasil Run Ini

Run ini berhasil.

Ringkasan paling penting:

```json
{
  "mode": "new",
  "room": "0x93164106F11aeE4F5a787dD710bB2EA0FCfca222",
  "voterCount": 30,
  "successCount": 30,
  "failedCount": 0,
  "totalVotes": 30,
  "eventCount": 30,
  "avgLatencyMs": 2056.366666666667,
  "avgGasUsed": 75455.33333333333
}
```

Artinya:

- Script membuat room baru.
- 30 EOA didaftarkan sebagai voter.
- 30 transaksi vote dikirim bersamaan.
- Semua 30 vote sukses.
- On-chain storage mencatat total vote 30.
- Event `VoteCast` yang ditemukan juga 30.
- Rata-rata latency vote sekitar 2.056 detik.
- Rata-rata gas untuk transaksi vote sekitar 75,455 gas.

## 2. Identitas Test

```json
"testName": "v5-room-30-eoa-concurrent-vote"
```

Ini nama skenario pengujian. Skenarionya adalah 30 EOA melakukan vote secara concurrent pada satu room voting.

Pada versi script terbaru, mode pengiriman vote bisa dipilih dengan:

```powershell
$env:VOTE_MODE="concurrent"
```

atau:

```powershell
$env:VOTE_MODE="sequential"
```

Jika `VOTE_MODE=concurrent`, hasil utama ditulis ke `voteRun` dan juga alias `concurrentVoting`.

Jika `VOTE_MODE=sequential`, hasil utama ditulis ke `voteRun` dan juga alias `sequentialVoting`.

```json
"mode": "new"
```

Mode `new` berarti script membuat room baru melalui `RoomFactory`.

Mode lain yang tersedia adalah `existing`, yaitu memakai room address yang sudah ada.

## 3. Room Dan Admin

```json
"room": "0x93164106F11aeE4F5a787dD710bB2EA0FCfca222",
"admin": "0x4E277e0DAE3DbA90C36Dc50fED2009a2404Cbc33"
```

`room` adalah address contract `VotingRoom` clone yang dibuat untuk run ini.

`admin` adalah EOA pertama dari `accounts\eoa-collections.json`. Dalam test ini, EOA pertama selalu dipakai sebagai room admin.

Admin bertugas untuk:

- membuat room baru, jika mode `new`
- set result center
- menambah voter
- menambah candidate
- start round
- stop round
- submit history ke `VotingResultCenter`

## 4. System Deployment

Bagian ini:

```json
"system": {
  "votingRoomImplementation": "0x3A8ecEe0e1807d772F2041363D377B32B565b21B",
  "roomFactory": "0xFF708d2c2fcaC90129bDf034A4ec3121f7E63952",
  "votingResultCenter": "0x90195833De057f952C47C2B1d2a857Cb18FD4555",
  "admin": "0x4E277e0DAE3DbA90C36Dc50fED2009a2404Cbc33",
  "network": "besu",
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 1337
}
```

menjelaskan kontrak utama yang dipakai oleh sistem test.

- `votingRoomImplementation`: contract implementation asli `VotingRoom`.
- `roomFactory`: factory untuk membuat room clone baru.
- `votingResultCenter`: contract pusat penyimpanan hasil round.
- `network`: nama network Hardhat.
- `rpcUrl`: RPC Besu yang dipakai.
- `chainId`: chain id private network.

File `deployments\room-system.json` menyimpan address-address ini agar script tidak perlu deploy ulang system setiap run.

## 5. Result Center

```json
"resultCenterUsed": "0x90195833De057f952C47C2B1d2a857Cb18FD4555"
```

Ini berarti room berhasil dikaitkan dengan `VotingResultCenter`.

Setelah voting selesai dan room di-stop, script memanggil:

```solidity
submitRoundHistory(roundId)
```

Tujuannya agar hasil final round juga tersimpan di `VotingResultCenter`.

## 6. Candidate

```json
"candidates": [
  { "id": 1, "name": "Candidate A" },
  { "id": 2, "name": "Candidate B" },
  { "id": 3, "name": "Candidate C" }
]
```

Script memasukkan 3 candidate ke room.

Dalam run ini, vote dibagi menggunakan pola:

```text
voter index 1  -> candidate 1
voter index 2  -> candidate 2
voter index 3  -> candidate 3
voter index 4  -> candidate 1
...
```

Karena ada 30 voter dan 3 candidate, hasil idealnya adalah:

```text
Candidate A: 10 vote
Candidate B: 10 vote
Candidate C: 10 vote
```

Hasil inspect memang menunjukkan angka tersebut.

## 7. Funded Accounts

```json
"voterCount": 30,
"fundedAccounts": [...]
```

Bagian ini menunjukkan 30 EOA yang dipakai untuk voting.

Contoh:

```json
{
  "address": "0x4E277e0DAE3DbA90C36Dc50fED2009a2404Cbc33",
  "funded": false,
  "balanceWei": "1000000000000000000"
}
```

Makna field:

- `address`: address EOA voter.
- `funded`: apakah pada run ini script mengirim saldo ke EOA tersebut.
- `balanceWei`: saldo EOA saat dicek.

Dalam hasil ini, semua `funded` bernilai `false`, tetapi balance tetap `1000000000000000000`.

Artinya akun-akun tersebut sudah punya saldo dari run sebelumnya, sehingga script tidak perlu funding ulang.

`1000000000000000000 wei` sama dengan `1 ether` atau `1 BESU` pada network lokal ini.

## 8. Prepare Room

Bagian:

```json
"prepare": {
  "statusBeforePrepare": {
    "roundId": 1,
    "state": 0,
    "readyToStart": true,
    "startAt": 0
  },
  "prepareTransactions": [...]
}
```

menjelaskan kondisi room sebelum voting dimulai dan transaksi persiapannya.

### Status Room

```json
"state": 0
```

`state = 0` berarti room masih `Inactive`.

```json
"readyToStart": true
```

Artinya room siap untuk dipanggil `start()`.

```json
"roundId": 1
```

Artinya ini round pertama untuk room tersebut.

### Transaksi Prepare

Ada 3 transaksi prepare:

```json
{
  "action": "setResultCenter",
  "gasUsed": "50778"
}
```

Room disambungkan ke `VotingResultCenter`.

```json
{
  "action": "addVoters",
  "gasUsed": "2129556"
}
```

30 EOA dimasukkan sebagai voter dalam satu batch transaction.

```json
{
  "action": "addCandidates",
  "gasUsed": "331151"
}
```

3 candidate dimasukkan dalam satu batch transaction.

## 9. Start Round

```json
"start": {
  "txHash": "0x8a2c58b7b34fd7d8a9fed60e42533a9de04a34f8b7e36206ff75d9ddecf9b2d1",
  "blockNumber": 797,
  "gasUsed": "64133"
}
```

Ini transaksi admin untuk memulai round.

Setelah `start()`, room berubah dari `Inactive` menjadi `Active`, dan voter boleh memanggil `vote(candidateId)`.

## 10. Vote Run

Bagian paling penting:

```json
"concurrentVoting": {
  "mode": "concurrent",
  "elapsedMs": 2225,
  "successCount": 30,
  "failedCount": 0,
  "minLatencyMs": 2024,
  "maxLatencyMs": 2095,
  "avgLatencyMs": 2056.366666666667,
  "totalGasUsed": "2263660",
  "avgGasUsed": 75455.33333333333
}
```

Pada versi script terbaru, bagian utama bernama:

```json
"voteRun": {
  "mode": "concurrent"
}
```

Untuk hasil lama seperti `room-vote-1778988541056.json`, nama field yang terlihat adalah `concurrentVoting`. Isinya sama-sama menjelaskan eksekusi vote.

Maknanya:

- `mode`: vote dikirim secara concurrent.
- `elapsedMs`: total waktu dari proses submit vote sampai semua receipt diterima.
- `successCount`: jumlah transaksi vote sukses.
- `failedCount`: jumlah transaksi vote gagal.
- `minLatencyMs`: latency tercepat dari satu vote.
- `maxLatencyMs`: latency terlama dari satu vote.
- `avgLatencyMs`: rata-rata latency vote.
- `totalGasUsed`: total gas dari semua transaksi vote sukses.
- `avgGasUsed`: rata-rata gas transaksi vote.

Dalam hasil ini:

```text
30 vote sukses
0 vote gagal
rata-rata latency 2056.37 ms
rata-rata gas 75455.33
```

Jika mode `sequential`, field `mode` akan menjadi:

```json
"mode": "sequential"
```

Pada sequential mode, 30 vote dikirim satu per satu. Script menunggu receipt setiap vote sebelum mengirim vote berikutnya. Dampaknya:

- log terminal tampil urut dari vote 1 sampai 30
- total waktu test biasanya lebih lama
- transaksi bisa masuk ke beberapa block berbeda
- hasil akhir tetap seharusnya `successCount = 30` dan `totalVotes = 30`

### Apa Arti Latency Di Sini?

`latencyMs` dihitung dari saat script mengirim transaksi vote sampai receipt transaksi ditemukan.

Ini bukan hanya waktu eksekusi Solidity. Ini mencakup:

- pengiriman transaksi ke RPC
- transaksi masuk tx pool
- transaksi dimasukkan ke block QBFT
- script polling receipt sampai receipt ditemukan

Karena QBFT di config memakai:

```json
"blockperiodseconds": 2
```

maka latency sekitar 2 detik adalah wajar.

### Kenapa Semua Vote Masuk Block 798?

Di rows terlihat semua vote punya:

```json
"blockNumber": 798
```

Artinya 30 transaksi vote berhasil masuk ke block yang sama.

Ini bagus untuk skenario concurrent voting, karena menunjukkan Besu menerima semua transaksi dan memprosesnya dalam satu block.

Pada mode sequential, belum tentu semua vote masuk ke block yang sama karena vote dikirim setelah receipt vote sebelumnya diterima.

### Kenapa Gas Used Tidak Selalu Sama?

Sebagian besar vote memakai:

```text
72512 gas
```

Tetapi ada beberapa yang memakai:

```text
89612 gas
126612 gas
```

Ini normal di EVM karena biaya gas bisa berbeda tergantung perubahan storage:

- menulis storage dari `0` ke non-zero lebih mahal
- menulis storage dari non-zero ke non-zero lebih murah
- urutan eksekusi transaksi dalam block menentukan slot storage mana yang pertama kali berubah

Jadi gas tidak harus sama untuk semua vote meskipun fungsi yang dipanggil sama.

## 11. Per Row Vote

Contoh satu row:

```json
{
  "index": 1,
  "voter": "0x4E277e0DAE3DbA90C36Dc50fED2009a2404Cbc33",
  "candidateId": 1,
  "ok": true,
  "txHash": "0x1488cd152af0ba536d2f1a6698e9de6e1affccfa5791c920340ef0144bf77ba9",
  "status": 1,
  "blockNumber": 798,
  "gasUsed": "72512",
  "latencyMs": 2063
}
```

Makna field:

- `index`: urutan voter dalam file EOA.
- `voter`: address EOA yang mengirim vote.
- `candidateId`: kandidat yang dipilih.
- `ok`: apakah script menganggap vote sukses.
- `txHash`: hash transaksi vote.
- `status`: status receipt EVM. `1` berarti sukses, `0` berarti revert/gagal.
- `blockNumber`: block tempat vote masuk.
- `gasUsed`: gas yang dipakai transaksi.
- `latencyMs`: waktu dari submit transaksi sampai receipt ditemukan.

Jika ada vote gagal, row tersebut akan punya `ok: false` dan biasanya field `error`.

## 12. Stop Round

```json
"stop": {
  "txHash": "0x623cba4a1ba9c590887577605558153f4c83084aaed0de2f6c47dca9f19066a3",
  "blockNumber": 799,
  "gasUsed": "492040"
}
```

Setelah semua vote selesai, admin memanggil `stop()`.

Saat `stop()`, contract:

- menghitung total voter
- menghitung total golput
- menyimpan history round di storage room
- mengubah state room menjadi `Inactive`
- membuat `roundReadyToStart = false`

Karena itulah room yang sudah di-stop perlu `reset()` atau `restart()` sebelum dipakai lagi.

## 13. Inspect On-chain Result

```json
"inspect": {
  "roundId": 1,
  "totalVotes": 30,
  "eventCount": 30,
  "candidates": [
    { "id": 1, "name": "Candidate A", "votes": 10 },
    { "id": 2, "name": "Candidate B", "votes": 10 },
    { "id": 3, "name": "Candidate C", "votes": 10 }
  ]
}
```

Ini adalah bukti hasil on-chain setelah voting selesai.

Validasi penting:

```text
successCount = 30
totalVotes = 30
eventCount = 30
jumlah votes candidate = 10 + 10 + 10 = 30
```

Karena semua angka konsisten, hasil test dianggap valid.

## 14. Submit History

```json
"submitHistory": {
  "ok": true,
  "txHash": "0x73397a891b35e0ef3a71a0d4396b94c2f5d243226e318ed34128d556932e4ae4",
  "blockNumber": 800,
  "gasUsed": "663002"
}
```

Ini berarti hasil round berhasil dikirim ke `VotingResultCenter`.

Tujuannya agar hasil voting tidak hanya ada di `VotingRoom`, tetapi juga dipublish ke contract pusat hasil.

## 15. Timeline Block

Dari result:

```text
start()              -> block 797
30 vote transactions -> block 798
stop()               -> block 799
submitRoundHistory() -> block 800
```

Ini alur yang ideal dan mudah diaudit:

1. Round dimulai.
2. Semua vote masuk.
3. Round dihentikan.
4. History dipublish.

## 16. Bagaimana Sistem Testing Saat Ini Bekerja

Script utama:

```text
scripts\run-room-test.js
```

Alurnya:

1. Baca 30 EOA dari `accounts\eoa-collections.json`.
2. EOA pertama dijadikan admin room.
3. Cek saldo 30 EOA.
4. Jika saldo kurang, fund EOA dari deployer Hardhat.
5. Jika `ROOM_MODE=new`, script:
   - membaca `deployments\room-system.json` jika ada
   - deploy system baru jika file deployment belum ada atau `REDEPLOY_SYSTEM=true`
   - membuat room baru lewat `RoomFactory`
6. Jika `ROOM_MODE=existing`, script:
   - memakai `ROOM_ADDRESS`
   - cek apakah EOA pertama adalah admin room
   - cek state room
   - jika room inactive tetapi belum ready, script default melakukan `reset()`
7. Script prepare room:
   - set `VotingResultCenter`
   - hapus voter/candidate lama jika ada
   - add 30 voter
   - add 3 candidate
8. Admin memanggil `start()`.
9. Script mengirim 30 transaksi vote sesuai `VOTE_MODE`.
10. Jika `concurrent`, transaksi dikirim paralel dan receipt ditunggu dengan concurrency terbatas agar RPC Besu lebih stabil.
11. Jika `sequential`, transaksi dikirim satu per satu dan setiap receipt ditunggu sebelum vote berikutnya dikirim.
12. Admin memanggil `stop()`.
13. Script membaca hasil on-chain:
   - `roundTotalVotes`
   - `getVotes`
   - event `VoteCast`
14. Script submit history ke `VotingResultCenter`.
15. Script menulis file result JSON ke folder `results`.

## 17. Kesimpulan Run Ini

Run `room-vote-1778988541056.json` sukses.

Bukti sukses:

- `successCount = 30`
- `failedCount = 0`
- `totalVotes = 30`
- `eventCount = 30`
- hasil kandidat seimbang: 10, 10, 10
- semua vote masuk block 798
- history berhasil submit ke `VotingResultCenter`

Secara evaluasi, run ini membuktikan bahwa `VotingRoom` v5 bisa menerima 30 vote dari 30 EOA berbeda secara concurrent pada Besu QBFT local, lalu menyimpan hasil on-chain dan mempublish history round ke result center.
