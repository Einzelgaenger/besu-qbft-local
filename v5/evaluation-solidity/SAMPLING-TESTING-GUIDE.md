# Sampling Testing Guide

Dokumen ini menjelaskan script sampling di folder `evaluation-solidity`.

Ada dua kelompok script:

1. **Sampling transaksi vote**
   - Unit sample = transaksi vote.
   - Cocok untuk uji ringan, baseline, dan pembacaan performa transaksi.

2. **Sampling TPS room**
   - Unit sample = TPS.
   - Dalam model kontrak v5, **1 TPS direpresentasikan sebagai 1 room**.
   - Cocok untuk metodologi thesis ketika unit sampling adalah Tempat Pemungutan Suara.

> Catatan istilah: dalam dokumen ini, TPS berarti **Tempat Pemungutan Suara**, bukan transaction per second.

## Konsep Model Testing

Mapping yang dipakai:

```text
1 room = 1 TPS simulasi
1 EOA = 1 voter simulasi
1 vote transaction = 1 suara dari voter di dalam room/TPS
```

Project v5 memakai 30 EOA dari:

```text
accounts/eoa-30.json
```

EOA yang sama boleh dipakai ulang di room berbeda karena aturan "satu voter satu vote" berlaku per room dan per round.

## Persiapan Umum

Jalankan Besu dari folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
docker compose up -d
docker ps
```

Lalu masuk ke folder evaluasi:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5\evaluation-solidity
npm run network:check
```

Jika EOA belum ada:

```powershell
npm run generate:eoa
```

Semua hasil test disimpan di:

```text
results/
```

Setiap room menghasilkan file:

```text
results/room-vote-TIMESTAMP.json
```

Setiap stage sampling menghasilkan file ringkasan:

```text
results/sampling-STAGE-ID-TIMESTAMP.json
```

## Kelompok 1: Sampling Transaksi Vote

Script ini dibuat untuk menguji beban transaksi vote. Pada kelompok ini, angka sample mengacu ke jumlah vote transaction, bukan jumlah TPS.

### `npm run sampling:smoke`

```text
1 room x 30 vote = 30 vote sample
Mode vote: sequential
Room berjalan: sequential karena hanya 1 room
```

Tujuan:

- memastikan flow dasar berjalan
- membuat room baru
- menambahkan 30 voter
- menambahkan 3 kandidat
- menjalankan start, vote, stop
- memastikan result JSON terbentuk

Interpretasi:

```text
1 room = 1 TPS simulasi
30 vote = 30 voter simulasi
```

Command:

```powershell
npm run sampling:smoke
```

### `npm run sampling:baseline`

```text
3 room x 30 vote = 90 vote sample
Mode vote: sequential
Room berjalan: sequential
```

Tujuan:

- mendapatkan baseline latency normal
- melihat performa saat vote dikirim satu per satu
- menjadi pembanding terhadap mode concurrent

Alur:

```text
Room 1 selesai penuh
Room 2 selesai penuh
Room 3 selesai penuh
```

Di setiap room:

```text
30 vote dikirim satu per satu
```

Command:

```powershell
npm run sampling:baseline
```

### `npm run sampling:main`

```text
13 room x 30 vote = 390 vote sample
Mode vote: concurrent
Room berjalan: sequential
```

Tujuan:

- menguji 390 transaksi vote
- melihat performa vote concurrent dalam setiap room
- cocok sebagai uji transaksi utama, bukan uji 390 TPS

Penting:

```text
Script ini bukan 390 TPS sample.
Script ini adalah 13 TPS simulasi dengan total 390 vote transaction.
```

Alur:

```text
Room 1 -> 30 vote concurrent -> stop -> result
Room 2 -> 30 vote concurrent -> stop -> result
...
Room 13 -> 30 vote concurrent -> stop -> result
```

Command:

```powershell
npm run sampling:main
```

### `npm run sampling:fault`

```text
2 room x 30 vote = 60 vote sample
Mode vote: concurrent
Room berjalan: sequential
Fault scenario: 1 node Besu dimatikan
```

Tujuan:

- menguji fault tolerance QBFT 4 node
- memastikan jaringan masih bisa memproses transaksi saat 1 node mati
- setelah test selesai, node yang dimatikan akan dinyalakan kembali

Default node yang dimatikan:

```text
besu-v5-node4
```

Command:

```powershell
npm run sampling:fault
```

Mengganti node yang dimatikan:

```powershell
$env:FAULT_NODE_CONTAINER="besu-v5-node3"
npm run sampling:fault
```

Jika node sudah dimatikan manual dan script tidak perlu menjalankan `docker stop`:

```powershell
$env:FAULT_SKIP_DOCKER_STOP="true"
npm run sampling:fault
```

## Kelompok 2: Sampling TPS Room

Script ini adalah kelompok yang lebih tepat untuk metodologi thesis jika unit sampling adalah TPS.

Pada kelompok ini:

```text
1 TPS sample = 1 room
```

Dengan 30 voter simulasi per TPS:

```text
1 TPS room = 30 vote transaction
```

Jika target sample adalah 390 TPS:

```text
390 TPS room x 30 vote = 11.700 vote transaction
```

### `npm run sampling:tps-smoke`

```text
1 TPS room
30 vote transaction
Mode vote: sequential
Room berjalan: sequential karena hanya 1 room
```

Tujuan:

- memastikan pemetaan 1 TPS = 1 room berjalan benar
- validasi flow dasar sebelum menjalankan batch besar

Command:

```powershell
npm run sampling:tps-smoke
```

### `npm run sampling:tps-baseline`

```text
3 TPS room
3 x 30 vote = 90 vote transaction
Mode vote: sequential
Room berjalan: sequential
```

Tujuan:

- baseline TPS dengan vote sequential
- pembanding untuk batch concurrent
- melihat latency saat transaksi vote diproses satu per satu

Alur:

```text
TPS room 1 -> 30 vote sequential -> stop -> result
TPS room 2 -> 30 vote sequential -> stop -> result
TPS room 3 -> 30 vote sequential -> stop -> result
```

Command:

```powershell
npm run sampling:tps-baseline
```

### `npm run sampling:tps-batch`

```text
30 TPS room per batch
30 x 30 vote = 900 vote transaction per batch
Mode vote: concurrent
Room berjalan: sequential
```

Tujuan:

- menjalankan sampling TPS dalam batch yang aman untuk laptop 8GB RAM
- setiap TPS dibuat sebagai room baru
- vote di dalam setiap TPS dikirim concurrent

Penting:

```text
Dalam 1 batch, 30 room tidak berjalan bersamaan.
Room berjalan satu per satu.
Yang concurrent adalah 30 vote di dalam masing-masing room.
```

Alur:

```text
TPS room 1 -> 30 vote concurrent -> stop -> result
TPS room 2 -> 30 vote concurrent -> stop -> result
...
TPS room 30 -> 30 vote concurrent -> stop -> result
```

Command batch pertama:

```powershell
$env:TPS_BATCH_INDEX="1"
npm run sampling:tps-batch
```

Batch berikutnya:

```powershell
$env:TPS_BATCH_INDEX="2"
npm run sampling:tps-batch
```

`TPS_BATCH_INDEX` hanya penanda nomor batch di nama stage/result. Nilai ini tidak mengubah jumlah room atau logic voting.

Untuk target 390 TPS:

```text
13 batch x 30 TPS room = 390 TPS room
390 TPS room x 30 vote = 11.700 vote transaction
```

Contoh menjalankan 13 batch secara manual:

```powershell
$env:TPS_BATCH_INDEX="1"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="2"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="3"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="4"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="5"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="6"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="7"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="8"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="9"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="10"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="11"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="12"; npm run sampling:tps-batch
$env:TPS_BATCH_INDEX="13"; npm run sampling:tps-batch
```

### `npm run sampling:tps-main`

```text
390 TPS room
390 x 30 vote = 11.700 vote transaction
Mode vote: concurrent
Room berjalan: sequential
```

Tujuan:

- menjalankan full main sampling TPS dalam satu proses
- membuat 390 room sebagai 390 TPS sample
- setiap room menjalankan 30 vote concurrent

Penting untuk laptop 8GB RAM:

```text
Script ini berat dan lama.
Disarankan menjalankan sampling:tps-batch sebanyak 13 kali daripada langsung sampling:tps-main.
```

Alur:

```text
TPS room 1 -> 30 vote concurrent -> stop -> result
TPS room 2 -> 30 vote concurrent -> stop -> result
...
TPS room 390 -> 30 vote concurrent -> stop -> result
```

Command:

```powershell
npm run sampling:tps-main
```

Jika ingin uji versi pendek:

```powershell
$env:SAMPLING_ROOM_COUNT="10"
npm run sampling:tps-main
```

### `npm run sampling:tps-fault`

```text
2 TPS room
2 x 30 vote = 60 vote transaction
Mode vote: concurrent
Room berjalan: sequential
Fault scenario: 1 node Besu dimatikan
```

Tujuan:

- menguji apakah jaringan QBFT 4 node tetap berjalan saat 1 node mati
- setiap TPS tetap direpresentasikan sebagai room
- vote di dalam setiap room tetap concurrent

Default node yang dimatikan:

```text
besu-v5-node4
```

Command:

```powershell
npm run sampling:tps-fault
```

Mengganti node:

```powershell
$env:FAULT_NODE_CONTAINER="besu-v5-node3"
npm run sampling:tps-fault
```

Jika node dimatikan manual:

```powershell
$env:FAULT_SKIP_DOCKER_STOP="true"
npm run sampling:tps-fault
```

## Variabel Konfigurasi

### `SAMPLING_ROOM_COUNT`

Mengubah jumlah room yang dijalankan.

Contoh menjalankan batch hanya 5 TPS:

```powershell
$env:SAMPLING_ROOM_COUNT="5"
npm run sampling:tps-batch
```

### `SAMPLING_ROOM_DELAY_MS`

Mengubah jeda antar-room.

Default:

```text
3000 ms
```

Untuk TPS batch dan TPS main, script memberi default lebih longgar:

```text
5000 ms
```

Jika RPC Besu sering timeout:

```powershell
$env:SAMPLING_ROOM_DELAY_MS="10000"
npm run sampling:tps-batch
```

### `TPS_BATCH_INDEX`

Nomor batch untuk `sampling:tps-batch`.

Contoh:

```powershell
$env:TPS_BATCH_INDEX="2"
npm run sampling:tps-batch
```

Hasil stage akan diberi nama:

```text
stage-3-tps-batch-02
```

### `POPULATION_TPS`

Jumlah populasi TPS untuk dicatat di result JSON.

Default saat ini:

```text
3000
```

Jika ingin mencatat populasi 30.000 TPS:

```powershell
$env:POPULATION_TPS="30000"
npm run sampling:tps-batch
```

### `VOTE_RUN_TIMEOUT_MS`

Timeout voting dalam satu room.

Contoh:

```powershell
$env:VOTE_RUN_TIMEOUT_MS="120000"
npm run sampling:tps-batch
```

### `RPC_RETRY_ATTEMPTS` dan `RPC_RETRY_DELAY_MS`

Dipakai oleh `run-room-test.js` untuk retry request RPC ringan seperti `getBalance`.

Contoh:

```powershell
$env:RPC_RETRY_ATTEMPTS="10"
$env:RPC_RETRY_DELAY_MS="2000"
npm run sampling:tps-batch
```

## Monitoring Storage Node

Setelah menjalankan sampling, ukuran data setiap node Besu akan bertambah karena block, receipt, log, dan state disimpan di folder node masing-masing.

Folder data node berada di:

```text
v5/nodes/node1/data
v5/nodes/node2/data
v5/nodes/node3/data
v5/nodes/node4/data
```

Jalankan command berikut dari folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
```

### Cek Ukuran Per Node Dalam Byte

```powershell
Get-ChildItem .\nodes\node1\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node2\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node3\data -Recurse | Measure-Object -Property Length -Sum
Get-ChildItem .\nodes\node4\data -Recurse | Measure-Object -Property Length -Sum
```

Cara baca output:

```text
Count = jumlah file yang dihitung
Sum   = total ukuran file dalam byte
```

Contoh:

```text
Sum : 9320278
```

Artinya:

```text
9,320,278 bytes ~= 8.89 MB
```

### Cek Ukuran Semua Node Dalam MB

Gunakan command ini agar output langsung tampil dalam MB:

```powershell
1..4 | ForEach-Object {
  $sum = (Get-ChildItem ".\nodes\node$_\data" -Recurse | Measure-Object -Property Length -Sum).Sum
  "node$_ = {0:N2} MB" -f ($sum / 1MB)
}
```

Contoh output:

```text
node1 = 8.89 MB
node2 = 8.89 MB
node3 = 8.82 MB
node4 = 8.85 MB
```

Interpretasi:

```text
Ukuran tiap node masih kecil jika masih puluhan MB.
Mulai pantau lebih hati-hati jika total folder nodes sudah mencapai beberapa GB.
Dengan storage 50GB, jalankan TPS sampling secara batch dan cek ukuran folder nodes setelah setiap batch.
```

## Rekomendasi Untuk Thesis

Untuk thesis dengan keterbatasan laptop 8GB RAM dan storage 50GB, gunakan struktur ini:

```text
1. npm run sampling:tps-smoke
   Validasi awal 1 TPS.

2. npm run sampling:tps-baseline
   Baseline 3 TPS dengan vote sequential.

3. npm run sampling:tps-batch sebanyak 13 batch
   Main sampling 390 TPS.
   Setiap TPS = 1 room.
   Setiap room = 30 vote concurrent.

4. npm run sampling:tps-fault
   Fault tolerance saat 1 node mati.
```

Jangan jadikan `sampling:main` sebagai klaim 390 TPS sample. Script tersebut adalah 390 vote sample dari 13 room.

Untuk klaim sampling TPS, gunakan kelompok:

```text
sampling:tps-*
```

## Narasi Metodologi Yang Disarankan

Contoh narasi:

> Penelitian ini memodelkan satu TPS sebagai satu VotingRoom pada smart contract. Setiap room berisi 30 EOA sebagai voter simulasi. Pengujian utama dilakukan secara batch untuk menyesuaikan keterbatasan perangkat lokal 8GB RAM dan 50GB storage. Pada setiap TPS room, transaksi vote dikirim secara concurrent untuk mensimulasikan beberapa voter yang melakukan voting dalam periode yang berdekatan. Antar-room dijalankan sequential agar pengukuran setiap TPS tetap stabil dan hasil on-chain dapat diaudit secara terpisah.

Untuk main sampling:

> Main sampling menggunakan 390 TPS room. Karena setiap TPS room menjalankan 30 vote transaction, total transaksi vote yang diuji adalah 11.700. Hasil pengujian dievaluasi melalui success count, failed count, total votes on-chain, event count, latency, dan gas used.

Untuk fault tolerance:

> Fault tolerance diuji dengan mematikan satu node dari jaringan Besu QBFT 4 node. Pengujian kemudian menjalankan beberapa TPS room dengan vote concurrent untuk memastikan jaringan tetap dapat memfinalisasi transaksi saat satu validator tidak aktif.
