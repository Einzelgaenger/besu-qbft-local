# Besu QBFT V5

Integrasi MongoDB off-chain dan cara menampilkan status dengan `chainId: 1337` tersedia di [MONGODB-SETUP.md](MONGODB-SETUP.md).

Panduan cepat ini untuk menjalankan network Besu dari file `docker-compose.yml` di folder `v5`.

## File Yang Dibutuhkan

Pastikan file dan folder berikut ada di `v5`:

```text
docker-compose.yml
.env
genesis.json
nodes\node1\data\key
nodes\node1\data\key.pub
nodes\node2\data\key
nodes\node2\data\key.pub
nodes\node3\data\key
nodes\node3\data\key.pub
nodes\node4\data\key
nodes\node4\data\key.pub
```

File `.env` dipakai oleh Docker Compose untuk mengisi `BOOTNODE_URL` di `docker-compose.yml`.

Jika `genesis.json`, `.env`, atau folder `nodes` belum ada, ikuti dulu:

```text
SETUP-BESU-QBFT-FROM-ZERO.md
```

## Jalankan Docker Compose

Masuk ke folder `v5`:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5
```

Jalankan semua node Besu dari `docker-compose.yml`:

```powershell
docker compose up -d
```

Command di atas otomatis membaca:

```text
docker-compose.yml
.env
```

Kalau ingin menyebut file `.yml` secara eksplisit:

```powershell
docker compose -f .\docker-compose.yml up -d
```

Gunakan command eksplisit ini kalau ingin memastikan Docker Compose memakai file `docker-compose.yml` di folder `v5`.

## Cek Container

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

## Cek RPC

Node RPC:

```text
Node 1: http://127.0.0.1:8545
Node 2: http://127.0.0.1:8546
Node 3: http://127.0.0.1:8547
Node 4: http://127.0.0.1:8548
```

Cek block number:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Cek peer node 1:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

Untuk 4 node hidup, peer node 1 biasanya `0x3`.

## Stop Network

```powershell
docker compose down
```

## Restart Network

```powershell
docker compose down
docker compose up -d
```

## Generate 150 EOA

Edit file `.env` di folder `v5`:

```text
BOOTNODE_URL=enode://...
ACCOUNT_COUNT=150
VOTER_COUNT=150
```

Jangan hapus `BOOTNODE_URL`, karena itu dipakai Docker Compose untuk bootnode Besu.

Makna env:

- `ACCOUNT_COUNT`: jumlah EOA yang dibuat oleh `npm run generate:eoa`.
- `VOTER_COUNT`: jumlah EOA yang dipakai saat `npm run room:test`.

Masuk ke folder evaluasi:

```powershell
cd C:\Users\LEGION\Documents\Binus\Thesis\besu-qbft-local\besu-qbft-local\v5\evaluation-solidity
```

Jalankan generate EOA:

```powershell
npm run generate:eoa
```

Output akan ditulis ulang ke:

```text
accounts\eoa-collections.json
```

Lalu jalankan room test:

```powershell
$env:ROOM_MODE="new"
npm run room:test
```

Alternatif sekali jalan tanpa edit `.env`:

```powershell
$env:ACCOUNT_COUNT="150"
$env:VOTER_COUNT="150"
npm run generate:eoa

$env:ROOM_MODE="new"
npm run room:test
```

Jika memakai alternatif `$env:` dan ingin balik ke default 30:

```powershell
Remove-Item Env:\ACCOUNT_COUNT
Remove-Item Env:\VOTER_COUNT
```

## Reset Chain Dari Nol

Gunakan ini kalau ingin menghapus chain data lokal dan generate ulang.

```powershell
docker compose down
Remove-Item -Recurse -Force .\networkFiles
Remove-Item -Recurse -Force .\nodes
Remove-Item -Force .\genesis.json
Remove-Item -Force .\.env
```

Setelah itu ulangi langkah setup dari:

```text
SETUP-BESU-QBFT-FROM-ZERO.md
```
