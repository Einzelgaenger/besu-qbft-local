# Panduan Pengujian Manipulasi Data

Dokumen ini menjelaskan pengujian **Security Analysis Against Data Manipulation** pada kontrak `VotingRoom`, mulai dari tujuan, cara kerja script, cara menjalankan pengujian, sumber data hasil, sampai cara membaca laporan.

## 1. Tujuan Pengujian

Pengujian ini memeriksa apakah aturan keamanan pada smart contract mampu menolak beberapa bentuk manipulasi voting berikut:

1. `duplicate vote`: satu EOA mencoba memberikan suara dua kali pada round yang sama.
2. `unauthorized voter`: EOA yang tidak terdaftar mencoba memberikan suara.
3. `invalid candidate`: voter memilih ID kandidat yang tidak terdaftar.
4. `direct modification of blockchain state`: EOA mencoba memanggil fungsi mutasi state yang tidak tersedia pada kontrak.
5. `forged transaction`: raw transaction dikirim menggunakan signature kriptografi yang tidak valid.
6. `modified transaction hash`: hash transaksi asli diubah, lalu dicari melalui setiap RPC validator.
7. `vote after room closed`: voter mencoba memberikan suara setelah room dihentikan.

Pengujian tidak membuat prototype atau kontrak baru. Script men-deploy instance terisolasi dari kontrak `VotingRoom` yang sama dengan implementasi penelitian, lalu menjalankan serangan terhadap instance tersebut.

## 2. File yang Digunakan

- Runner: `scripts/security-manipulation-test.js`
- Kontrak yang diuji: `contracts/VotingRoom.sol`
- Perintah npm: `security:manipulation` di `package.json`
- Laporan manusia: `results/security-manipulation/TIMESTAMP/report.md`
- Bukti teknis: `results/security-manipulation/TIMESTAMP/evidence.json`

Setiap eksekusi menggunakan folder timestamp baru. Hasil run sebelumnya tidak ditimpa.

## 3. Prasyarat

Sebelum menjalankan test, pastikan:

1. Node.js dan npm tersedia.
2. Dependency telah dipasang dengan `npm.cmd ci` atau `npm.cmd install`.
3. Jaringan Besu QBFT sedang aktif.
4. RPC utama tersedia pada URL di `BESU_RPC_URL`, dengan default `http://127.0.0.1:8545`.
5. Akun deployer dari `PRIVATE_KEY` memiliki akses untuk mengirim transaksi. Jaringan lokal ini menggunakan `gasPrice: 0`.
6. Endpoint validator untuk pemeriksaan konsistensi dapat diakses.

Default endpoint validator adalah:

```text
http://127.0.0.1:8545
http://127.0.0.1:8546
http://127.0.0.1:8547
http://127.0.0.1:8548
```

## 4. Cara Menjalankan

Dari folder `v5/evaluation-solidity`, jalankan:

```powershell
npm.cmd run security:manipulation
```

Pemakaian `npm.cmd` menghindari error PowerShell Execution Policy yang memblokir `npm.ps1`.

Untuk menentukan endpoint validator sendiri:

```powershell
$env:SECURITY_RPC_URLS="http://127.0.0.1:8545,http://127.0.0.1:8546"
npm.cmd run security:manipulation
```

Timeout setiap request RPC dapat diubah dalam milidetik:

```powershell
$env:SECURITY_RPC_TIMEOUT_MS="10000"
npm.cmd run security:manipulation
```

Folder hasil juga dapat ditentukan sendiri:

```powershell
$env:SECURITY_RESULT_DIR="C:\hasil\security-run-01"
npm.cmd run security:manipulation
```

## 5. Urutan Kerja Script

### 5.1 Membuat fixture pengujian

Script melakukan langkah berikut:

1. Mengambil signer admin dari konfigurasi jaringan Hardhat.
2. Membuat dua wallet voter dan satu wallet outsider secara acak.
3. Men-deploy `VotingRoom` baru.
4. Memanggil `initialize()` menggunakan admin.
5. Mendaftarkan dua voter melalui `addVoters()`.
6. Menambahkan kandidat ID `1` dan `2` melalui `addCandidates()`.
7. Mengaktifkan round melalui `start()`.
8. Mengirim satu vote valid dari voter pertama sebagai kondisi awal.

Dengan fixture terisolasi, pengujian tidak bergantung pada room voting penelitian yang sedang digunakan dan tidak mengubah hasil room tersebut.

### 5.2 Mengambil snapshot state

Sebelum dan sesudah hampir setiap percobaan manipulasi, fungsi `snapshot()` membaca langsung state kontrak berikut:

- `getCurrentRoundStatus()` untuk round dan status room;
- `roundTotalVotes(round)` untuk total vote;
- `getVotes(round, candidateId)` untuk vote setiap kandidat;
- `lastVotedRound(address)` untuk status vote setiap akun uji.

Snapshot sebelum dan sesudah dibandingkan sebagai JSON. Nilai `stateUnchanged: true` hanya diberikan jika seluruh nilai tersebut identik.

### 5.3 Menentukan PASS atau FAIL

Untuk skenario yang seharusnya ditolak, status ditentukan dengan aturan:

```text
PASS = action rejected AND stateUnchanged = true
FAIL = salah satu dari dua kondisi tersebut tidak terpenuhi
```

Script sengaja memberikan `gasLimit` saat mengirim transaksi negatif. Dengan demikian transaksi dapat dikirim ke node dan kegagalan diamati sebagai revert, bukan hanya ditolak oleh estimasi gas pada sisi client.

Skenario modified transaction hash menggunakan kriteria berbeda. Skenario ini lulus jika seluruh endpoint yang dikonfigurasi:

- menemukan transaksi menggunakan hash kanonis;
- mengembalikan hash yang sama dengan hash kanonis; dan
- tidak menemukan transaksi menggunakan hash yang telah dimodifikasi.

## 6. Cara Kerja Setiap Skenario

### 6.1 Duplicate vote

Voter pertama telah memberikan satu vote valid. Script meminta voter yang sama memilih kandidat lain pada round yang sama.

Sumber proteksi kontrak:

```solidity
if (lastVotedRound[voter] == currentRound) revert AlreadyVotedThisRound();
```

Hasil yang diharapkan: transaksi revert, total vote tetap satu, dan vote kandidat tidak berubah.

### 6.2 Unauthorized voter

Wallet outsider tidak dimasukkan melalui `addVoters()`, tetapi mencoba memanggil `vote()`.

Sumber proteksi kontrak:

```solidity
if (!voterRegistry[voter]) revert VoterNotEligible();
```

Hasil yang diharapkan: transaksi revert dan state voting tetap sama.

### 6.3 Invalid candidate

Voter terdaftar mencoba memilih kandidat ID `999999`, sedangkan fixture hanya memiliki kandidat ID `1` dan `2`.

Sumber proteksi kontrak:

```solidity
if (!candidateRegistry[candidateId]) revert CandidateNotFound(candidateId);
```

Hasil yang diharapkan: transaksi revert dan voter tersebut belum ditandai sudah memilih.

### 6.4 Direct modification of blockchain state

Script membuat calldata untuk fungsi fiktif berikut:

```text
setRoundTotalVotes(uint256,uint256)
```

Fungsi tersebut tidak ada pada `VotingRoom`. Calldata dikirim langsung sebagai transaksi ke alamat kontrak dengan target nilai vote palsu `999999`.

Hasil yang diharapkan: EVM me-revert transaksi karena selector tidak dikenal dan kontrak tidak menyediakan fallback untuk mutasi tersebut. Nilai `roundTotalVotes` serta vote kandidat harus tetap sama.

Pengujian ini membuktikan bahwa EOA tidak dapat mengubah storage melalui interface transaksi yang diuji. Pengujian ini tidak mensimulasikan kompromi mesin validator atau perubahan database node secara langsung.

### 6.5 Forged transaction

Script mula-mula membuat transaksi vote dengan struktur yang valid. Komponen signature `r` kemudian diganti dengan zero hash sehingga signature menjadi tidak valid. Raw transaction tersebut dikirim melalui provider.

Hasil yang diharapkan: RPC/node menolak transaksi sebelum eksekusi kontrak dan state voting tidak berubah.

### 6.6 Modified transaction hash

Script menggunakan hash dari vote valid pertama sebagai hash kanonis. Karakter hex terakhir kemudian diubah untuk membentuk hash lain. Kedua hash dicari melalui `eth_getTransactionByHash` pada seluruh endpoint validator.

Hasil yang diharapkan:

- hash asli menemukan transaksi asli;
- nilai `hash` pada transaksi cocok dengan hash asli;
- hash yang dimodifikasi mengembalikan `null`;
- seluruh validator memberi hasil yang sama.

Mengubah teks hash tidak mengubah transaksi maupun state blockchain. Hash berfungsi sebagai identifier yang terikat pada isi transaksi.

### 6.7 Vote after room closed

Admin menjalankan `stop()`, sehingga state room menjadi `Inactive`. Voter kedua kemudian mencoba memberikan vote.

Sumber proteksi kontrak adalah modifier:

```solidity
inState(State.Active)
```

Hasil yang diharapkan: transaksi revert dengan kondisi `InvalidState` dan state voting tetap sama.

## 7. Pemeriksaan Konsistensi Validator

Setelah seluruh skenario selesai, script mengambil satu nomor block tetap. Pada block tersebut, setiap endpoint RPC diminta memberikan:

- block hash melalui `eth_getBlockByNumber`;
- `roundTotalVotes` melalui `eth_call`;
- vote kandidat `1` dan `2` melalui `eth_call`;
- status room melalui `eth_call`.

Status validator adalah `PASS` hanya jika semua endpoint yang dikonfigurasi dapat diakses dan mengembalikan block hash serta state yang identik. Jika satu endpoint tidak tersedia atau jawabannya berbeda, status menjadi `INCONCLUSIVE`.

Pemeriksaan pada nomor block tetap penting agar perbandingan tidak mencampurkan state dari tinggi block yang berbeda.

## 8. Dari Mana Result Diperoleh

Nilai pada result bukan data buatan atau kesimpulan yang ditulis manual. Sumbernya adalah:

| Field hasil | Sumber data |
|---|---|
| `rejection` | Error dari receipt transaksi EVM atau respons JSON-RPC |
| `before` dan `after` | Pemanggilan view function langsung ke kontrak melalui provider Hardhat |
| `stateUnchanged` | Perbandingan seluruh field snapshot sebelum dan sesudah serangan |
| `realHash` | Hash receipt dari vote valid pertama |
| `modifiedHash` | Hash kanonis dengan satu digit terakhir diubah oleh runner |
| `originalFound` | Respons `eth_getTransactionByHash` untuk hash asli |
| `modifiedFound` | Respons `eth_getTransactionByHash` untuk hash modifikasi |
| `blockHash` | Respons `eth_getBlockByNumber` dari masing-masing RPC validator |
| `stateValues` | Respons `eth_call` pada block tetap dari masing-masing validator |
| `status` skenario | Evaluasi otomatis berdasarkan rejection dan state integrity |
| `overallStatus` | Agregasi status seluruh skenario dan pemeriksaan validator |

Dengan demikian, klaim “smart contract reject”, “transaction reverted”, “state tidak berubah”, dan “validator mempertahankan state yang sama” masing-masing memiliki bukti teknis di `evidence.json`.

## 9. Struktur Result

Contoh struktur direktori:

```text
results/
  security-manipulation/
    2026-07-29T17-47-33-075Z/
      report.md
      evidence.json
```

Timestamp nama folder menggunakan format ISO berbasis UTC. Waktu Jakarta adalah UTC+7.

### 9.1 `report.md`

File ini ditujukan untuk dibaca manusia. Isinya:

- identitas network, kontrak, dan round;
- ringkasan jumlah PASS, FAIL, dan INCONCLUSIVE;
- tabel hasil seluruh skenario;
- penjelasan hasil dan error tiap skenario;
- status konsistensi validator;
- interpretasi serta keterbatasan pengujian.

### 9.2 `evidence.json`

File ini adalah bukti machine-readable yang lebih detail. Field utamanya:

```text
schemaVersion
testName
executedAt
network
contract
summary
scenarios[]
validatorConsensus
```

Setiap elemen `scenarios[]` dapat memiliki:

- `id`: identifier stabil skenario;
- `title`: nama skenario;
- `status`: `PASS`, `FAIL`, atau `INCONCLUSIVE`;
- `expected`: perilaku yang seharusnya terjadi;
- `observed`: ringkasan yang benar-benar diamati;
- `rejection`: error dari transaksi/RPC;
- `stateUnchanged`: hasil perbandingan snapshot;
- `before`: state sebelum percobaan;
- `after`: state setelah percobaan;
- hash dan respons validator untuk skenario yang relevan.

## 10. Cara Membaca Status

### PASS

Kontrol yang diuji bekerja pada eksekusi tersebut. Untuk negative test, serangan ditolak dan state tidak berubah. PASS bersifat empiris pada konfigurasi dan bytecode yang diuji, bukan formal proof untuk seluruh jenis serangan.

### FAIL

Serangan tidak ditolak atau state berubah. Runner mengembalikan exit code gagal jika overall status adalah FAIL. Periksa `unexpectedReceipt`, `before`, `after`, dan `rejection` pada `evidence.json`.

### INCONCLUSIVE

Bukti tidak cukup untuk membuat klaim, umumnya karena satu atau lebih endpoint validator tidak dapat diakses. INCONCLUSIVE tidak boleh dilaporkan sebagai PASS.

### Overall status

Prioritas agregasi adalah:

```text
Ada skenario FAIL                         -> FAIL
Tidak ada FAIL, tetapi ada INCONCLUSIVE   -> INCONCLUSIVE
Semua skenario dan validator PASS         -> PASS
```

## 11. Contoh Interpretasi Hasil Aktual

Pada run `2026-07-29T17-47-33-075Z`, diperoleh:

- 7 skenario PASS;
- 0 skenario FAIL;
- 0 skenario INCONCLUSIVE;
- 4 dari 4 endpoint validator merespons;
- seluruh validator mengembalikan block hash yang sama pada block `644`;
- seluruh validator mengembalikan total vote `1`, vote kandidat 1 sebanyak `1`, vote kandidat 2 sebanyak `0`, dan room berstatus `Inactive`.

Interpretasinya: pada pengujian tersebut, seluruh manipulasi yang diuji ditolak atau tidak dapat menggantikan transaksi kanonis, state voting tetap konsisten, dan empat endpoint validator mempertahankan hasil state yang sama.

## 12. Batasan Penelitian

Pengujian ini adalah **empirical security testing**, bukan audit keamanan penuh dan bukan formal verification. Ruang lingkup yang belum diuji mencakup:

- kompromi private key admin atau voter;
- akses langsung penyerang ke database/host validator;
- validator Byzantine melebihi toleransi konsensus QBFT;
- kerentanan dependency dan runtime node;
- serangan jaringan seperti partition berkepanjangan;
- perubahan bytecode atau upgrade kontrak di luar instance yang diuji;
- exhaustive fuzzing terhadap seluruh kombinasi input.

Karena testing nyata telah dilakukan, subsection penelitian dapat menyatakan hasil aktual sesuai file evidence. Keterbatasan di atas tetap harus dicantumkan agar klaim penelitian tidak melampaui cakupan pengujian.
