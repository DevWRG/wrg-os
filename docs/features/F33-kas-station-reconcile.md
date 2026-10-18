# F33 — Kas Station Reconcile Harian Cabang

| | |
|---|---|
| Domain | Finance |
| FR | FR-FS-33 |
| Status | DRAFT (kartu board hanya 1 kalimat; detail dari jawaban Direktur) |
| Branch | `feat/f33-kas-station-reconcile` |
| Migrasi | `234_kas_station.sql` — ⚠️ butuh diterapkan Direktur ke prod |
| Kunci izin | `kas-station` (station) dan `kas-station-review` (pusat) — butuh Sync Fitur |

## Ringkasan

Station = **kas cabang** (satu cabang = satu station; kunci = nilai `cabang` huruf besar dari
roster `master_user`/`hod_territory`). Setiap station punya dana idle sendiri.

```
Station mencatat kas harian → sistem merekap per minggu (Senin–Minggu)
  → station mengajukan rekap ke pusat → pusat melihat & approve/reject
  → bila approve: dana direalisasikan ke station
```

Pusat **tidak** input atau merekap ulang — hanya meninjau dan memutuskan.

## Cara kerja

**Kas harian** (`kas_station_harian` + `kas_station_transaksi`)
- `saldo_akhir = saldo_awal + Σmasuk − Σkeluar` — dihitung, tidak disimpan.
- `saldo_awal` diisi manual **hanya pada catatan pertama station**; setelahnya diset sistem = saldo akhir
  catatan sebelumnya (input manual yang berbeda ditolak). Hari tanpa catatan tidak memutus rantai.
- `saldo_fisik` (opsional) dibandingkan dengan saldo hitungan → `selisih = fisik − sistem`. Hanya
  ditampilkan; **tidak ada toleransi dan tidak ada pemblokiran**.
- Bukti = teks referensi (`bukti_ref`: nomor nota/tautan), bukan unggahan berkas.

**Rekap mingguan** (`kas_station_rekap`)
- Dibuat/disegarkan dari catatan harian satu minggu (`POST /kas-station/rekap`), menyimpan snapshot
  (saldo awal, total masuk/keluar, saldo akhir, total selisih, jumlah hari). Satu baris per `(cabang, minggu)`.
- Status: `draft → submitted → approved | rejected`; `rejected` bisa diperbaiki dan diajukan lagi.
  Saat diajukan snapshot **dihitung ulang** dari data terbaru.
- Realisasi dana dicatat di baris rekap `approved` (`realisasi_nominal` diisi **manual**, sekali saja).
- Semua perubahan status memakai satu transaksi + advisory lock per cabang + guard `WHERE status = …`,
  jadi dua keputusan bersamaan hanya satu yang menang (yang lain 409).

## Aturan penjaga (supaya data tetap konsisten)

| Aturan | Respons |
|---|---|
| Satu catatan per `(cabang, tanggal)` | 409 |
| Tanggal tidak boleh di masa depan (WIB) / format salah / tanggal mustahil | 400 |
| Catatan harus berurutan: tanggal ≤ catatan terakhir station ditolak (tanpa catatan mundur) | 409 |
| Saldo akhir tidak boleh negatif (kas keluar > saldo tersedia) | 422 |
| Hanya **catatan terakhir** station yang boleh diubah/dihapus (saldo awal hari berikutnya bergantung padanya) | 409 |
| Catatan di minggu yang rekapnya `submitted`/`approved` **terkunci** | 409 |
| Minggu rekap harus diawali hari Senin dan sudah dimulai; minggu tanpa catatan tidak bisa direkap | 400 / 422 |
| Tolak rekap wajib menyertakan alasan (agar station tahu apa yang diperbaiki) | 400 |
| Realisasi hanya untuk rekap `approved` dan hanya sekali; nominal > 0 | 409 / 400 |
| Transaksi identik dalam 10 detik ditolak (guard klik ganda, seperti F51) | 409 |
| Nominal: angka desimal polos (string `0x10`/`1e3` ditolak), ≥ 0 (transaksi/realisasi > 0), maks. 2 desimal, maks. 1 triliun per nilai | 400 |
| Maks. 200 transaksi per request pembuatan catatan | 400 |
| Tahun tanggal ≥ 2000 (menolak `0000`/`0001`/salah ketik `0026`; Postgres `date` tak punya tahun 0) | 400 |
| Teks/parameter mengandung karakter NUL (`\u0000`) — Postgres menolaknya | 400 |
| `actor` maks. 100 karakter (kolom `audit_log.human_actor` varchar(100)) | 400 |
| Body kosong dianggap `{}` (mis. submit tanpa isian) | — |
| Akumulasi total melebihi `numeric(16,2)` saat merekap | 422 |
| Tabel belum dimigrasi | 503 `migration_pending` |

Setiap perubahan ditulis ke `audit_log` (`event_type` `kas_station.*`, `agent_id` pinjam `'A3'` seperti F11/F60).

## Akses

Dua kunci di matriks Akses Grup, supaya siapa yang mengisi dan siapa yang approve bisa diatur per grup:

| Kunci | Aksi | Arti |
|---|---|---|
| `kas-station` (station) | view / create / edit / delete | lihat · catat harian, buat & ajukan rekap, tambah transaksi · ubah saldo fisik/keterangan · hapus catatan/transaksi |
| `kas-station-review` (pusat) | view / edit | lihat rekap semua cabang · approve/reject & catat realisasi |

Sebelum Sync Fitur, fallback identitas hanya `direktur`/`admin`/`superuser` (`canOrLegacy`). User tanpa grup
= tanpa akses walau role direktur (by design, sama seperti F31).
Izin ditegakkan di BFF `app/api/kas-station/[[...path]]` (peta method+path → izin di
`lib/kas-station-access.ts`, rute tak dikenal ditolak, `actor` ditimpa dari sesi).

Endpoint API (`apps/api`, prefix `/kas-station`): `GET cabang`, `GET|POST harian`, `GET|PATCH|DELETE harian/:id`,
`POST harian/:id/transaksi`, `PATCH|DELETE harian/:id/transaksi/:trxId`, `GET|POST rekap`, `GET rekap/:id`,
`POST rekap/:id/{submit,decide,realisasi}`.

## Sengaja TIDAK dibuat (belum ada keputusan bisnis — jangan ditebak)

- Toleransi selisih, tenggat pengisian/pengajuan, hari wajib isi.
- Rumus nominal pengajuan / realisasi (realisasi diisi manual; rekap hanya menyimpan hasil roll-up).
- Pembatasan cabang per user (user ber-izin `kas-station` bisa mencatat untuk cabang mana pun yang terdaftar).
- Pemisahan tugas (pengaju ≠ penyetuju), multi-level approval, notifikasi WhatsApp, scheduler/cron.
- Unggah berkas bukti, accounting/GL, rekonsiliasi bank, budgeting.

## Perlu dikonfirmasi ke Direktur

1. Siapa yang mengisi di cabang dan siapa yang approve di pusat (→ centang grup di Akses Grup).
2. Isi nominal pengajuan/realisasi: mengikuti total kas keluar, saldo akhir, atau input manual?
3. Apakah user station dibatasi ke cabangnya sendiri? (butuh sumber cabang per user)
4. Apakah perlu toleransi selisih, tenggat, atau pengingat (WA/dashboard)?
5. Bukti transaksi: cukup referensi teks, atau perlu unggah berkas?
6. Apakah pengaju boleh sekaligus menjadi penyetuju?

## Pasca-deploy

1. Direktur menerapkan migrasi `234_kas_station.sql` ke prod (additive, idempoten, dengan backup).
2. Build `@wrg/api` + `@wrg/web`, restart pm2 (bentuk ecosystem).
3. Klik **Sync Fitur**, lalu centang `kas-station` untuk grup station dan `kas-station-review` untuk grup pusat.

## Uji

- `apps/api/src/repo/kas-station.test.ts` — logika murni (saldo, selisih, tanggal/minggu, roll-up, mesin status, parse nominal).
- `apps/web/src/lib/kas-station-access.test.ts` — gate akses dan peta rute BFF.
- Uji integrasi ke DB dummy dijalankan dengan skrip sekali pakai (tidak masuk repo karena butuh DB): tingkat repo 90 cek, tingkat HTTP 200 cek, jam disimulasikan (tengah minggu, Jumat, batas 00:00 WIB), data historis (lintas tahun, kabisat), race paralel, performa (2000 catatan), constraint skema langsung, migrasi seluruh rantai di DB kosong, BFF, dan UI Chrome headless (41 cek).
