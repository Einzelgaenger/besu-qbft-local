# Setup Besu QBFT V5 Dari Nol

Dokumen ini menjelaskan setup jaringan Besu QBFT lokal dari nol khusus untuk folder `besu-qbft-local\v5`.

Target akhir:

- 4 validator QBFT lokal
- RPC node 1 di `http://127.0.0.1:8545`
- chain id `1337`
- deployer/funder default: `0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266`
- script evaluasi Solidity v5 bisa dijalankan dari `v5\evaluation-solidity`

## 1. Prasyarat

Pastikan sudah terinstall:

- Docker Desktop
- Node.js 20+
- npm
- PowerShell

Pastikan Docker Desktop sedang berjalan.

## 2. Masuk Ke Folder V5

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
```

Semua perintah network di bawah ini dijalankan dari folder `v5`.

## 3. Buat Struktur Folder Network

```powershell
New-Item -ItemType Directory -Force config, networkFiles, nodes, nodes\node1, nodes\node2, nodes\node3, nodes\node4, nodes\node1\data, nodes\node2\data, nodes\node3\data, nodes\node4\data
```

File `config\qbftConfigFile.json` dan `docker-compose.yml` sudah disediakan di folder `v5`.

## 4. Generate Genesis Dan Key Validator

```powershell
docker run --rm -v ${PWD}:/opt/besu/network hyperledger/besu:latest operator generate-blockchain-config --config-file=/opt/besu/network/config/qbftConfigFile.json --to=/opt/besu/network/networkFiles --private-key-file-name=key
```

Output utama:

```text
networkFiles\genesis.json
networkFiles\keys\...
```

Copy genesis ke root `v5`:

```powershell
Copy-Item .\networkFiles\genesis.json .\genesis.json
```

## 5. Copy Key Validator Ke Node

```powershell
$keys = Get-ChildItem .\networkFiles\keys

Copy-Item "$($keys[0].FullName)\key*" .\nodes\node1\data\
Copy-Item "$($keys[1].FullName)\key*" .\nodes\node2\data\
Copy-Item "$($keys[2].FullName)\key*" .\nodes\node3\data\
Copy-Item "$($keys[3].FullName)\key*" .\nodes\node4\data\
```

## 6. Buat File `.env` Bootnode

Ambil public key node 1 dan buat `BOOTNODE_URL`.

```powershell
$pub = Get-Content .\nodes\node1\data\key.pub
$pub = $pub.Trim().Replace("0x","")
"BOOTNODE_URL=enode://$pub@172.21.0.11:30303" | Out-File -Encoding ascii .env
```

`docker-compose.yml` memakai subnet `172.21.0.0/24`, sehingga bootnode diarahkan ke `172.21.0.11`.

## 7. Jalankan Besu

```powershell
docker compose up -d
```

Atau jalankan dengan file `.yml` eksplisit:

```powershell
docker compose -f .\docker-compose.yml up -d
```

Gunakan command eksplisit ini kalau ingin memastikan Docker Compose membaca `docker-compose.yml` dari folder `v5`.

Cek container:

```powershell
docker ps
```

Ekspektasi container:

```text
besu-v5-node1
besu-v5-node2
besu-v5-node3
besu-v5-node4
```

Lihat log node 1:

```powershell
docker logs -f besu-v5-node1
```

## 8. Cek RPC Dan Peer

Cek peer node 1:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

Ekspektasi untuk 4 node: `0x3`.

Cek block number:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Ekspektasi: block number kedua lebih besar. Dengan `blockperiodseconds = 2`, idealnya naik sekitar 5 block dalam 10 detik.

Cek validator:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
```

Ekspektasi: muncul 4 validator.

## 9. Setup Script Evaluasi Solidity V5

Masuk ke folder evaluasi:

```powershell
cd .\evaluation-solidity
```

Install dependency:

```powershell
npm install
```

Compile kontrak:

```powershell
npm run compile
```

Generate EOA voter:

```powershell
npm run generate:eoa
```

Default-nya membuat 30 EOA. Untuk membuat 150 EOA lewat file env, edit `.env` di folder `v5`:

```text
BOOTNODE_URL=enode://...
ACCOUNT_COUNT=150
VOTER_COUNT=150
```

Jangan hapus `BOOTNODE_URL`, karena itu dipakai Docker Compose untuk bootnode Besu.

Lalu jalankan:

```powershell
npm run generate:eoa
```

Output:

```text
evaluation-solidity\accounts\eoa-collections.json
```

EOA pertama akan dipakai sebagai admin room.

Jika ingin menjalankan testing dengan 150 voter, pastikan `VOTER_COUNT=150` juga ada di `.env`. Nanti saat menjalankan `room:test`, script akan mengambil 150 EOA pertama dari file `accounts\eoa-collections.json`.

Alternatif sekali jalan tanpa edit `.env`:

```powershell
$env:ACCOUNT_COUNT="150"
$env:VOTER_COUNT="150"
npm run generate:eoa
```

## 10. Cek Network Dari Script Evaluasi

```powershell
npm run network:check
```

Ekspektasi:

- semua RPC `8545` sampai `8548` merespons
- chain id `1337`
- node 1 punya `peerCount = 3`
- block number muncul
- validator QBFT muncul

## 11. Jalankan Testing Room Baru

Script akan:

1. fund 30 EOA dari deployer default
2. deploy `VotingRoom` implementation
3. deploy `RoomFactory`
4. deploy `VotingResultCenter`
5. buat room baru dengan admin EOA pertama
6. masukkan 30 EOA sebagai voter
7. masukkan 3 candidate
8. start round
9. kirim 30 vote sesuai `VOTE_MODE`
10. stop round
11. simpan hasil ke file result

```powershell
$env:ROOM_MODE="new"
npm run room:test
```

Jika `VOTE_MODE` tidak diisi, default-nya adalah:

```text
concurrent
```

Artinya 30 EOA mengirim transaksi vote secara paralel.

Untuk memilih mode vote secara eksplisit:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="concurrent"
npm run room:test
```

atau:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="sequential"
npm run room:test
```

Perbedaannya:

- `concurrent`: 30 vote dikirim hampir bersamaan. Log terminal bisa tidak urut karena transaksi dan receipt diproses paralel.
- `sequential`: vote dikirim satu per satu. Script menunggu receipt vote pertama sebelum mengirim vote berikutnya, sehingga log terminal urut tetapi durasi test lebih lama.

Untuk fault tolerance test, script punya timeout total voting:

```text
VOTE_RUN_TIMEOUT_MS=60000
```

Default `60000 ms` berarti 60 detik. Jika proses vote melewati batas ini, script akan berhenti menunggu/mengirim vote, mencoba `stop()` room, inspect hasil on-chain yang sudah masuk, dan tetap menyimpan result parsial ke folder `results`.

Ubah timeout jika diperlukan:

```powershell
$env:ROOM_MODE="new"
$env:VOTE_MODE="concurrent"
$env:VOTE_RUN_TIMEOUT_MS="30000"
npm run room:test
```

Metrics seperti average latency dan average gas akan dihitung dari transaksi vote yang sukses saja.

Custom nama room dan candidate:

```powershell
$env:ROOM_MODE="new"
$env:ROOM_NAME="Room Evaluasi V5"
$env:CANDIDATES="Candidate A,Candidate B,Candidate C"
npm run room:test
```

Hasil disimpan ke:

```text
evaluation-solidity\results\room-vote-TIMESTAMP.json
```

Deployment system disimpan ke:

```text
evaluation-solidity\deployments\room-system.json
```

## 12. Jalankan Testing Existing Room

Syarat existing room:

- contract room adalah `VotingRoom` v5
- EOA pertama di `accounts\eoa-30.json` adalah `roomAdmin`
- jika room masih `Active`, script otomatis memanggil `stop()` dulu
- jika `roundReadyToStart = false`, script default akan memanggil `reset()` agar room siap dipakai ulang

Jalankan:

```powershell
$env:ROOM_MODE="existing"
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:test
```

Jika room masih `Active`, script otomatis menjalankan `stop()` dari admin, lalu lanjut prepare room.

Jika room `Inactive` tetapi `roundReadyToStart = false`, script default menjalankan `reset()`. Jika ingin perilaku lain:

```powershell
$env:ROOM_REUSE_ACTION="reset"    # default
$env:ROOM_REUSE_ACTION="restart"
$env:ROOM_REUSE_ACTION="error"
```

## 13. Jalankan Aksi Room Manual

Setelah `room-system.json` tersedia dari `npm run room:test` atau deploy sebelumnya, aksi room bisa dijalankan bertahap dari folder `v5\evaluation-solidity`.

File deployment yang dipakai:

```text
evaluation-solidity\deployments\room-system.json
```

Command otomatis yang tersedia:

- `room:reset`: menjalankan `reset()` pada room.
- `room:add-voter`: memasukkan 30 EOA dari `accounts\eoa-30.json`.
- `room:add-candidate`: memasukkan 3 candidate default dengan id `1`, `2`, `3`.
- `room:start`: menjalankan `start()` saja.
- `room:stop`: menjalankan `stop()` saja.
- `room:vote`: otomatis `start()` jika room sudah ready, mengirim 30 vote dari 30 EOA ke 3 candidate, otomatis memanggil `stop()`, lalu menulis result ke folder `results`.

Reset room:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:reset
```

Tambah 30 voter dari `accounts\eoa-30.json`:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:add-voter
```

Tambah 3 candidate default:

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

Jika ingin custom nama candidate:

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

Jika room `Inactive` tetapi `roundReadyToStart=false` karena baru selesai `stop()`, `room:start` default menjalankan `restart()` dulu lalu `start()` agar voter/candidate lama tetap dipakai. Jika langsung menjalankan `room:vote` saat room sudah ready tetapi belum `Active`, script akan memanggil `start()` otomatis. Jadi `room:start` opsional jika ingin memisahkan langkah start.

Stop room saja:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:stop
```

Jika langsung menjalankan `room:vote`, script akan memanggil `stop()` otomatis setelah vote selesai atau timeout. Jadi `room:stop` opsional untuk menutup room aktif secara manual.

Kirim 30 vote dari 30 EOA ke candidate `1`, `2`, dan `3`, lalu otomatis `stop()`:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
npm run room:vote
```

Sebelum vote, script mengecek status room. Jika room `Inactive` dan `roundReadyToStart = true`, script otomatis memanggil `start()` lalu lanjut vote. Jika room `Inactive` dan `roundReadyToStart = false`, script memakai `ROOM_REUSE_ACTION` seperti `room:test`. Default-nya adalah `reset`.

```powershell
$env:ROOM_REUSE_ACTION="reset"    # default
$env:ROOM_REUSE_ACTION="restart"
$env:ROOM_REUSE_ACTION="error"
```

Jika `room:vote` menjalankan `reset()` atau `restart()`, script berhenti setelah aksi itu karena voter/candidate mungkin perlu disiapkan ulang. Setelah itu jalankan lagi `room:add-voter`, `room:add-candidate`, lalu `room:vote`.

Default vote memakai:

```text
VOTE_MODE=concurrent
VOTE_RUN_TIMEOUT_MS=60000
```

Untuk sequential vote:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:VOTE_MODE="sequential"
npm run room:vote
```

Untuk membatasi waktu vote, misalnya 30 detik:

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:VOTE_MODE="concurrent"
$env:VOTE_RUN_TIMEOUT_MS="30000"
npm run room:vote
```

Jika ada transaksi yang belum selesai sampai timeout, script tetap mencoba `stop()` dan menulis result ke:

```text
evaluation-solidity\results\room-vote-manual-TIMESTAMP.json
```

Result tersebut mencatat `room`, `roomName`, ringkasan vote, hasil on-chain, dan status `stop()` otomatis.

Jika transaksi admin seperti `room:stop` masuk block tetapi receipt punya `status=0`, coba beri gas limit admin lebih besar:

```powershell
$env:ADMIN_GAS_LIMIT="5000000"
npm run room:stop
```

Versi argumen npm untuk opsi utama:

```powershell
npm run room:reset -- --room 0xROOM_ADDRESS
npm run room:add-voter -- --room 0xROOM_ADDRESS
npm run room:add-candidate -- --room 0xROOM_ADDRESS
npm run room:start -- --room 0xROOM_ADDRESS
npm run room:stop -- --room 0xROOM_ADDRESS
npm run room:vote -- --room 0xROOM_ADDRESS --vote-mode concurrent --candidate-ids 1,2,3
```

Catatan:

- `room:reset`, `room:add-voter`, dan `room:add-candidate` dikirim oleh admin room.
- Admin room diambil dari `deployments\room-system.json`, lalu private key-nya dicari di `accounts\eoa-30.json`.
- Jika admin tidak ada di file account, isi `$env:ADMIN_PRIVATE_KEY`.
- `room:vote` dikirim oleh 30 private key voter dari `accounts\eoa-30.json`.
- Setelah voting selesai atau timeout, `room:vote` otomatis memanggil `stop()` memakai admin room dan mencatatnya di result.
- Detail parameter lengkap ada di `evaluation-solidity\README.md`.

## 14. Inspect Hasil Round

```powershell
$env:ROOM_ADDRESS="0xROOM_ADDRESS"
$env:ROUND_ID="1"
npm run room:inspect
```

Output menampilkan:

- status room
- total votes
- event count `VoteCast`
- voter count
- vote per candidate
- latest published version di `VotingResultCenter` jika tersedia

## 15. Stop Besu

Jika posisi masih di `v5\evaluation-solidity`, kembali dulu ke `v5`:

```powershell
cd ..
```

Stop container:

```powershell
docker compose down
```

## 16. Fault Tolerance Network

Container validator di folder `v5` memakai nama:

```text
besu-v5-node1
besu-v5-node2
besu-v5-node3
besu-v5-node4
```

Jadi gunakan nama container tersebut saat stop/start validator.

Baseline block number:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Matikan 1 validator:

```powershell
docker stop besu-v5-node4
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Ekspektasi: block tetap naik karena 4-node QBFT masih toleran terhadap 1 validator mati.

Matikan validator kedua:

```powershell
docker stop besu-v5-node3
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":3}'
```

Ekspektasi: jaringan 4-node QBFT biasanya tidak bisa finalize jika 2 validator mati.

Nyalakan kembali:

```powershell
docker start besu-v5-node3
docker start besu-v5-node4
```

## 17. Reset Chain Dari Nol Lagi

Pastikan container mati:

```powershell
docker compose down
```

Hapus data generated:

```powershell
Remove-Item -Recurse -Force .\networkFiles
Remove-Item -Recurse -Force .\nodes
Remove-Item -Force .\genesis.json
Remove-Item -Force .\.env
```

Lalu ulangi dari langkah 3.

## 18. Detail Network Untuk Wallet

Jika ingin menambahkan network ini ke wallet seperti MetaMask:

```text
Network Name: Besu QBFT V5 Local
RPC URL: http://127.0.0.1:8545
Chain ID: 1337
Currency Symbol: BESU
Block Explorer: kosongkan
```

Default funded account:

```text
Address: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
