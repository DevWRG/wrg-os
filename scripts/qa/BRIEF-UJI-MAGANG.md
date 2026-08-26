# Brief uji fitur OPS/GA — untuk tim magang

Kalian membangun 43 fitur (33 menu baru). Semuanya sudah lolos uji **baca** —
tak ada satu pun endpoint yang error, bahkan pada volume data produksi. Yang
**belum pernah diuji sama sekali** adalah jalur **tulis**: simpan, ubah, hapus.

Itu tugas kalian di brief ini. Menu-nya belum aktif di produksi dan tidak akan
diaktifkan sebelum tahap ini lewat.

---

## ⛔ Aturan data — baca ini dulu

**JANGAN memakai salinan database produksi.** Bukan karena birokrasi; isinya:

- `app_user.password_hash` — hash kata sandi akun login
- `master_user.wa_number` — nomor HP pribadi 63 karyawan
- `insentif_*` dan `npk_*` — besaran insentif dan nilai kinerja **per orang**
- `raport_narrative`, `employee*` — catatan HR
- `product_pricelist` — price book (sengaja tak pernah masuk repo, karena repo ini publik)
- `accurate_customer`, `accurate_invoice*` — pelanggan & pendapatan nyata
- `wa_message` — percakapan WhatsApp staf

Sekali ada di laptop banyak orang, kendalinya hilang dan tak bisa ditarik lagi.

**Yang kalian pakai:** database sendiri di laptop masing-masing, diisi data
**sintetis** — ~46.000 baris buatan yang volumenya menyerupai produksi tapi
isinya karangan. Semua nama diawali `SINTETIS`, semua id di ruang 900.000.000+,
jadi tak mungkin tertukar dengan data nyata bahkan di screenshot.

Kalau butuh sesuatu yang menurut kalian cuma bisa diuji dengan data nyata,
**tanya dulu** — jangan mengambil sendiri.

---

## Setup (sekali saja, ±15 menit)

Butuh: Node 22, pnpm 11.5.2, PostgreSQL, dan `pgvector`.

```bash
brew install pgvector          # macOS; extension pihak ketiga, wajib
```

### 1. Database

`migrate.sh` **tidak bisa** memulai dari database kosong — berkas `001` memuat
`CREATE DATABASE` yang haram di dalam transaksi. Jadi extension-nya dipasang
manual dulu, `001` ditandai sudah jalan, baru migrasi lanjut:

```bash
createdb wrg_os_dev

psql -d wrg_os_dev -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
                       CREATE EXTENSION IF NOT EXISTS "pgcrypto";
                       CREATE EXTENSION IF NOT EXISTS "pg_trgm";
                       CREATE EXTENSION IF NOT EXISTS "vector";'

psql -d wrg_os_dev -c "CREATE TABLE IF NOT EXISTS schema_migrations (
                         filename TEXT PRIMARY KEY,
                         applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
                       INSERT INTO schema_migrations(filename)
                         VALUES ('001_extensions.sql') ON CONFLICT DO NOTHING;"

DATABASE_URL=postgres:///wrg_os_dev bash scripts/db/migrate.sh
# harapan: "✓ semua migrasi pending ter-apply (155 file)."
```

### 2. Data — URUTANNYA WAJIB

`seed-dev-full.sql` bergantung pada `seed-dev.sql` (`crm_account.owner_am_id`
punya FK ke `master_user`, dan AM `demo1`–`demo3` datang dari yang pertama).
Dibalik atau dilewati → `violates foreign key constraint crm_account_owner_fk`.

```bash
psql -d wrg_os_dev -f scripts/db/seed-dev.sql
psql -d wrg_os_dev -f scripts/db/seed-dev-full.sql
psql -d wrg_os_dev -f scripts/qa/seed-hashtag-fixtures.sql
psql -d wrg_os_dev -f scripts/qa/seed-volume-sintetis.sql     # ~46.000 baris, ±2 detik
```

Berkas terakhir mencetak ringkasan. Harapan:

```
accurate_item            6000     accurate_invoice_item   12000
accurate_customer         500     accurate_sales_order     3400
accurate_invoice         2000     accurate_delivery_order  3300
item_stock_branch       18000     item_stock_batch          3792
product_pricelist (SIN)   500
```

Semuanya idempoten — aman dijalankan ulang kapan saja.

### 3. Jalankan aplikasinya

Buat berkas `.env` di **akar repo** (sudah masuk `.gitignore`):

```
DATABASE_URL=postgres:///wrg_os_dev
AUTH_ENABLED=false
API_SERVICE_TOKEN=dev-token-lokal
API_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APP_URL=http://localhost:3000
WA_DRY_RUN=true
WA_INBOUND_PROCESS=false
AGENT_SCHEDULE_ENABLED=false
```

> **JANGAN tambahkan `PORT=` di berkas ini.** API dan web dua-duanya membacanya,
> jadi Next.js akan merebut port API dan API-nya gagal naik. Biarkan kosong: API
> otomatis di 4000, web di 3000. (`.env.example` juga sengaja tak menyetelnya.)

Tiga env terakhir memastikan tak ada WhatsApp terkirim dan tak ada cron jalan
dari laptop kalian. Jangan diubah.

```bash
pnpm install
pnpm dev
```

Buka `http://localhost:3000` → otomatis ke `/overview`.

`AUTH_ENABLED=false` berarti **tak perlu login**, dan semua 33 menu langsung
terjangkau. Itu memang disengaja untuk lingkungan uji.

---

## Yang diuji: JALUR TULIS

Membuka menu saja **tidak cukup** — jalur baca sudah diuji dan hasilnya bersih.
Yang belum pernah dijalankan siapa pun adalah menyimpan data.

Untuk **tiap** menu yang kalian pegang:

1. **Simpan baris baru** lewat form. Isi yang wajar dulu.
2. **Ubah** baris itu. Semua kolom, bukan cuma satu.
3. **Hapus** — dan kalau ada baris yang seharusnya tak bisa dihapus (sudah
   dipakai di tempat lain), pastikan penolakannya jelas, bukan error mentah.
4. **Simpan yang tidak wajar**, dan ini yang paling sering menemukan bug:
   - kolom wajib dikosongkan
   - angka negatif, angka nol, angka sangat besar
   - tanggal selesai lebih awal dari tanggal mulai
   - teks sangat panjang di kolom nama
   - dua baris dengan kode/nomor yang sama
   - tekan Simpan dua kali cepat
5. **Alur berstatus** (approval, purchase order, shipment): jalankan sampai
   selesai, lalu coba **melangkahi tahap** — misalnya menyetujui yang sudah
   disetujui, atau melompati satu langkah. Di situ biasanya penjaganya bolong.
6. **Muat ulang halaman** setelah menyimpan. Yang tampil harus sama dengan yang
   tersimpan.

---

## Cara melaporkan

Satu isu satu laporan, dan sertakan:

- menu + URL (mis. `/purchase-orders`)
- apa yang kalian lakukan, langkah demi langkah, sampai bisa diulang orang lain
- yang **diharapkan** vs yang **terjadi**
- screenshot
- pesan error dari terminal `pnpm dev` (bagian `@wrg/api:dev`) — **ini yang
  paling berguna**, sering lebih menjelaskan daripada tampilan layarnya
- kalau error database: barisnya dari log, apa adanya

Data sintetis itu **deterministik** — semua orang punya isi yang identik. Jadi
"item 4210 salahnya begini" berarti hal yang sama di laptop siapa pun. Manfaatkan:
sebut id/nomor barisnya di laporan.

---

## Bukan bug — jangan dilaporkan

- **Menu OPS/GA isinya kosong di awal.** Tabel fitur kalian memang kosong sampai
  ada yang mengisi. Itu juga kondisi produksi hari pertama.
- **Detail vendor Accurate → 503 "kredensial Accurate tak tersedia".** Ditarik
  langsung dari API Accurate; kredensialnya tidak ada di laptop, dan memang tidak
  akan diberikan.
- **`/health/mirror` → 503.** Melaporkan mirror Accurate basi. Di laptop kalian
  mirror-nya memang tak pernah disinkron, jadi 503 itu jawaban yang benar.
- **Nama produk/pelanggan aneh** (`ITEM SINTETIS 0421`, `FASKES SINTETIS 088`).
  Itu memang data karangan.
- **Angka rupiah tidak masuk akal secara bisnis.** Yang diuji rumus dan alurnya,
  bukan realisme angkanya. Tapi kalau **matematikanya** salah (subtotal ≠ jumlah
  barisnya, PPN bukan 11%, sisa tagihan ≠ total − dibayar) → **itu bug, laporkan.**

---

## Kalau tersangkut

| Gejala | Sebab |
|---|---|
| `CREATE DATABASE cannot run inside a transaction block` | `migrate.sh` di database kosong — ikuti langkah 1 |
| `violates foreign key constraint crm_account_owner_fk` | `seed-dev.sql` belum dijalankan sebelum `seed-dev-full.sql` |
| `Cannot find module .../dist/db.js` padahal build "sukses" | buildinfo basi: `rm -f apps/api/tsconfig.tsbuildinfo` lalu build lagi |
| API tak naik, web malah di 4000 | ada `PORT=` di `.env` — buang |
| Menu kosong padahal seed sudah jalan | pastikan `seed-volume-sintetis.sql` yang terakhir jalan, dan `DATABASE_URL` di `.env` menunjuk database yang sama |

Mulai dari nol lagi kapan saja: `dropdb wrg_os_dev` lalu ulangi langkah 1–2.
Tak ada yang berharga di sana.

---

## Sebelum lapor selesai

```bash
pnpm lint && pnpm typecheck && pnpm test
node scripts/qa/smoke-api-read.mjs        # harus GAGAL: 0
```

Kalau kalian mengubah kode, dua-duanya harus tetap hijau.

Rujukan lain: `scripts/qa/README.md` (detail harness), `docs/LOCAL-DEV.md` (setup
alternatif via Docker).
