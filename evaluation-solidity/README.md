# Simple Voting Evaluation Contract

Kontrak ini dibuat untuk menjalankan bagian smart contract, vote transaction, latency, dan audit consistency dari `evaluation-plan-04052026.md`.

## Setup

Jalankan dari folder ini:

```powershell
npm install
npm run compile
```

Pastikan jaringan Besu sudah hidup dari root repo:

```powershell
docker compose up -d
```

## Deploy

```powershell
npm run deploy
```

Output deployment disimpan ke `deployments/simple-voting.json`, termasuk contract address, transaction hash, block number, dan gas used.

Jika ingin mengganti nama kandidat:

```powershell
$env:CANDIDATES="Alice,Bob,Charlie"; npm run deploy
```

Alternatif tanpa Hardhat: buka `contracts/SimpleVoting.sol` di Remix, pilih compiler `0.8.24`, lalu deploy ke injected/custom provider dengan RPC `http://127.0.0.1:8545`, chain id `1337`, dan private key dari `../address-private-key.txt`.

## Kirim Vote Berkali-kali

Default mengirim 30 transaksi vote secara berurutan:

```powershell
npm run vote
```

Untuk jumlah lain:

```powershell
$env:VOTE_COUNT="10"; npm run vote
```

Skrip akan mencetak CSV:

```text
index,candidateId,txHash,blockNumber,gasUsed,latencyMs,status
```

Ringkasan min, max, dan average latency disimpan ke folder `results`.

## Cek Hasil On-chain

```powershell
npm run inspect
```

Output berisi:

- `totalVotes` dari storage contract
- `eventCount` dari event `VoteCast`
- total vote per kandidat dari fungsi `getResults()`

Untuk audit consistency, bandingkan data ini dengan dashboard/indexer. Data on-chain dianggap source of truth.

## Catatan Fungsi

- `vote(candidateId)`: satu transaksi untuk satu vote. Cocok untuk uji latency.
- `voteMany(candidateIds)`: banyak vote dalam satu transaksi. Cocok untuk uji gas/event batch, tetapi kurang cocok untuk latency per klik.
- Kontrak sengaja tidak membatasi satu address satu vote, supaya account evaluasi yang sama bisa dipakai berkali-kali.
