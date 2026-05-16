# Evaluation Plan - Besu QBFT Local

Dokumen ini berisi langkah praktis untuk mencoba evaluasi sistem pada jaringan Besu QBFT lokal di repo ini.

## 0. Menjalankan jaringan

Jalankan dari root project:

```powershell
docker compose up -d
docker ps
```

Jika Docker memberi error `Access is denied` di Windows, buka Docker Desktop dan jalankan PowerShell sebagai Administrator.

RPC utama:

- Node 1: `http://localhost:8545`
- Node 2: `http://localhost:8546`
- Node 3: `http://localhost:8547`
- Node 4: `http://localhost:8548`

## 1. Network connectivity test

Tujuan: memastikan node Besu saling terhubung.

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

Ekspektasi untuk 4 node: hasil `0x3` pada node 1, karena node 1 punya 3 peer.

Ulangi ke node lain:

```powershell
Invoke-RestMethod -Uri http://localhost:8546 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
Invoke-RestMethod -Uri http://localhost:8547 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
Invoke-RestMethod -Uri http://localhost:8548 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
```

## 2. Block production test

Tujuan: memastikan QBFT memproduksi block secara kontinu.

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Ekspektasi: block number kedua lebih besar. Dengan `blockperiodseconds = 2`, dalam 10 detik idealnya naik sekitar 5 block.

## 3. Validator verification test

Tujuan: memastikan validator aktif sesuai genesis.

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
```

Ekspektasi: muncul 4 validator:

- `0xeebc325b0841c998fc0d2f0db39fc34f53a2424d`
- `0x47216173a6e37712a9b0538ca832a9d8b89cd8ea`
- `0x6893955e1cc2d857ce06a4f7888a0747c5043941`
- `0x9aea1595c7a5ed6e5bd73664d0ad3778548ee71e`

## 4. Smart contract deployment test

Tujuan: deploy smart contract voting ke private Besu network.

Gunakan network berikut di Remix, Hardhat, Foundry, atau aplikasi deployment kamu:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `1337`
- Account: `0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266`
- Private key: lihat `address-private-key.txt`

Constructor demo:

```text
["Candidate A", "Candidate B", "Candidate C"]
```

Setelah deploy, catat:

- contract address
- transaction hash
- block number deployment
- gas used

Verifikasi receipt:

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["TX_HASH_DEPLOYMENT"],"id":1}'
```

## 5. Vote transaction test

Tujuan: mengirim transaksi vote melalui RPC dan/atau relayer layer.

Untuk uji lewat UI/relayer:

1. Pastikan frontend/backend relayer mengarah ke `http://127.0.0.1:8545`.
2. Klik tombol vote.
3. Simpan transaction hash dari response backend atau log relayer.
4. Cek receipt:

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["TX_HASH_VOTE"],"id":1}'
```

Ekspektasi:

- `status = 0x1`
- `blockNumber` tidak null
- event vote muncul di log contract, jika contract mengeluarkan event

## 6. Latency measurement

Tujuan: mengukur waktu dari voter klik tombol vote sampai transaksi masuk ke finalized block.

Metode sederhana:

1. Di frontend, catat timestamp tepat sebelum request vote dikirim: `t_click`.
2. Di backend/relayer, catat timestamp saat receipt sudah tersedia: `t_confirmed`.
3. Hitung: `latency_ms = t_confirmed - t_click`.

Jika uji manual, gunakan PowerShell:

```powershell
$start = Get-Date
# klik vote atau kirim request vote di sini
# polling receipt sampai blockNumber muncul
$end = Get-Date
($end - $start).TotalMilliseconds
```

Untuk hasil evaluasi, lakukan minimal 10-30 vote dan catat min, max, average.

## 7. Fault tolerance test

Tujuan: memastikan jaringan tetap produksi block saat sebagian validator mati.

Baseline:

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Matikan 1 validator:

```powershell
docker stop besu-node4
```

Cek block tetap naik:

```powershell
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":2}'
```

Ekspektasi: dengan 4 validator, jaringan masih berjalan jika 1 validator mati.

Matikan validator kedua untuk menguji batas toleransi:

```powershell
docker stop besu-node3
Start-Sleep -Seconds 10
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":3}'
```

Ekspektasi: jaringan kemungkinan berhenti/fail to finalize karena 4-node QBFT hanya toleran terhadap 1 faulty validator.

Nyalakan lagi:

```powershell
docker start besu-node3
docker start besu-node4
```

## 8. Audit consistency test

Tujuan: memastikan dashboard/indexer bukan source of truth.

Langkah:

1. Ambil data vote dari dashboard/indexer.
2. Ambil data langsung dari blockchain melalui contract call atau event log.
3. Bandingkan total vote per candidate dan total transaksi vote.

Data on-chain bisa dicek melalui:

- read function contract, misalnya `getVotes(candidateId)` atau fungsi serupa
- event logs dengan `eth_getLogs`
- receipt transaksi vote dengan `eth_getTransactionReceipt`

Contoh cek log contract:

```powershell
Invoke-RestMethod -Uri http://localhost:8545 -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","method":"eth_getLogs","params":[{"address":"CONTRACT_ADDRESS","fromBlock":"0x0","toBlock":"latest"}],"id":1}'
```

Ekspektasi:

- total vote dashboard sama dengan total vote on-chain
- setiap vote di dashboard memiliki transaction hash valid
- jika berbeda, data on-chain dianggap benar

## Template hasil pengujian

| Test | Command/Data | Expected Result | Actual Result | Status |
| --- | --- | --- | --- | --- |
| Network connectivity | `net_peerCount` | `0x3` di node 1 | | |
| Block production | `eth_blockNumber` naik | block naik tiap sekitar 2 detik | | |
| Validator verification | `qbft_getValidatorsByBlockNumber` | 4 validator | | |
| Contract deployment | deployment tx receipt | `status = 0x1` | | |
| Vote transaction | vote tx receipt | `status = 0x1` | | |
| Latency | `t_confirmed - t_click` | tercatat dalam ms | | |
| Fault tolerance | stop 1 validator | block tetap naik | | |
| Audit consistency | dashboard vs on-chain | data sama | | |
