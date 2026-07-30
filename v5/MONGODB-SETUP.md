# MongoDB off-chain untuk Besu v5 (chain ID 1337)

Besu tidak menulis langsung ke MongoDB. `offchain-indexer` membaca event melalui JSON-RPC Besu, lalu menyimpan salinan/query model ke MongoDB. Blockchain tetap menjadi sumber kebenaran; MongoDB adalah penyimpanan off-chain.

## 1. Menjalankan Besu dan MongoDB

Pastikan Docker Desktop sudah aktif, lalu dari folder `v5`:

```powershell
docker compose up -d
docker compose ps
```

MongoDB tersedia di `mongodb://127.0.0.1:27017/besu_voting`, sedangkan Besu node 1 di `http://127.0.0.1:8545`.

## 2. MongoDB Compass

Klik **Add new connection**, masukkan:

```text
mongodb://127.0.0.1:27017/besu_voting
```

Klik **Connect**. Database dan collection otomatis muncul setelah data pertama ditulis. Gunakan filter berikut di collection `rooms`:

```json
{ "chainId": 1337 }
```

## 3. Instal dan cek koneksi

```powershell
cd .\offchain-indexer
npm install
npm run check
```

Output yang benar memuat `mongodb: connected`, `besu: connected`, dan `chainId: 1337`.

Untuk membuat tiga contoh status seperti gambar (`pending`, `canceled`, `confirmed`):

```powershell
npm run seed:demo
```

Refresh collection `rooms` pada Compass. Contoh ini hanya data demonstrasi untuk pengambilan screenshot, bukan transaksi blockchain asli.

## 4. Sinkronisasi event blockchain asli

Deploy sistem room terlebih dahulu dari `evaluation-solidity`, lalu salin nilai `roomFactory` dari `deployments/room-system.json` ke `ROOM_FACTORY_ADDRESS` pada `.env` di folder v5:

```text
ROOM_FACTORY_ADDRESS=0xAlamatRoomFactory
```

Sinkron satu kali atau pantau terus:

```powershell
npm run sync
npm run watch
```

Event `RoomRegistered` akan menghasilkan/upsert dokumen `rooms` berstatus `confirmed` dan dokumen audit di `votingroomevents`. Checkpoint blok tersimpan di `syncstates`, sehingga restart tidak mengulang seluruh chain.

Status `pending`, `canceled`, dan `failed` adalah lifecycle aplikasi/wallet dan harus ditulis ketika request dibuat, ditolak pengguna, atau transaksi gagal. Event on-chain hanya dapat mengonfirmasi status `confirmed`.

## 5. Reset data MongoDB

Menghapus container saja tidak menghapus data. Untuk reset MongoDB sekaligus volume (destruktif untuk database ini):

```powershell
docker compose down
docker volume rm v5_mongodb-data
```

Nama volume aktual dapat diperiksa dengan `docker volume ls` apabila nama project Compose berbeda.
