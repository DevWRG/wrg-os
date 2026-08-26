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

## Yang diuji juga: COMMAND HASHTAG WA

15 command hashtag (`#STOK` `#CEK` `#PRICING` `#SPH` `#KLAIM` `#install`
`#servis` `#training` `#kalibrasi` `#KIRIM` `#BAST` `#BUKTI` `#HELPDESK`
`#APPROVE` `#REJECT`) **tidak lewat UI sama sekali**. Jadi membuka menu tak akan
pernah menyentuhnya — butuh cara sendiri.

### Tak ada WhatsApp yang terkirim dari laptop kalian

Tiga lapis pengaman, dan semuanya sudah ada di `.env` yang kalian buat:

| Pengaman | Efek |
|---|---|
| `WA_SEND_URL` **tidak di-set** | tak ada gateway sama sekali → mode STUB, balasan cuma dicetak ke terminal |
| `WA_DRY_RUN=true` | walau gateway ter-set, tetap tak kirim live |
| `WA_INBOUND_PROCESS=false` | pemrosesan inbound mati total (default) |

> **JANGAN pernah mengisi `WA_SEND_URL`.** Itu satu-satunya cara laptop kalian
> bisa benar-benar mengirim WhatsApp. Uji dari branch `dev` hanya boleh menyentuh
> grup WA **"Research"** — grup live itu produksi, bukan tempat uji. Dan itu
> dijalankan dari server, bukan dari laptop.

### Langkah 1 — jalankan harness dulu (acuan)

```bash
node scripts/qa/sim-hashtag.mjs
# harapan: total=42  cocok=42  beda=0  error=0
```

42 skenario: 15 command + varian argumen kosong, format salah, kode tak ketemu,
plafon diskon, galat state machine, dan 5 uji penembusan gerbang pengirim.
**Kalau ini belum hijau, jangan lanjut** — berarti setup-nya yang belum benar,
bukan fiturnya.

Filter kalau cuma mau sebagian: `node scripts/qa/sim-hashtag.mjs stok sph`

### Langkah 2 — uji format bebas (di sinilah bug baru ketemu)

Harness cuma menguji 42 skenario yang sudah dipikirkan. Yang belum: format yang
orang sungguhan tulis di WA. Untuk itu suntik pesan sendiri.

Nyalakan pemrosesan inbound — aman, karena dua pengaman lain tetap jalan:

```bash
# di .env, ubah satu baris ini saja:
WA_INBOUND_PROCESS=true
```

Lalu suntik pesan dan proses:

```bash
psql -d wrg_os_dev -c "INSERT INTO wa_message
  (group_jid, sender_jid, sender_name, message_type, body, input_hash, message_id)
  VALUES ('grup-uji@g.us','628111000001@s.whatsapp.net','Dewi Fixture','text',
          '#STOK SIN.00042','uji-1','uji-1')"

curl -s -X POST -H "x-service-token: dev-token-lokal" \
  -H 'content-type: application/json' -d '{"limit":10}' \
  http://localhost:4000/wa/inbound/process
```

`input_hash` harus **unik** tiap suntikan (itu kunci anti-duplikat) — pakai
`uji-2`, `uji-3`, dst.

Nomor `628111000001` = AM fixture `Dewi Fixture`, satu-satunya yang lolos gerbang
pengirim. Nomor lain akan didiamkan (itu benar, lihat di bawah).

**Balasannya ada di dua tempat:**

Terminal `pnpm dev`, di antara penanda:

```
--- pesan ---
📦 *ITEM SINTETIS 0042 CONSUMABLE* (SIN.00042)
Total (semua cabang): 294 PACK — live, update otomatis tiap 5 menit
Cabang Kediri: 228 PACK (data per 14 Agu 2026)
--- selesai ---
```

Atau di database, tanpa perlu mengubek log:

```bash
psql -d wrg_os_dev -c "SELECT processed_kind, processed_result
  FROM wa_message WHERE input_hash = 'uji-1'"
```

### Yang perlu dicoba

Balasan command hashtag itu **teks yang dibaca orang di WA** — jadi salah format
atau salah sebut nama sama seriusnya dengan salah hitung.

1. **Argumen kosong** — `#STOK` tanpa apa-apa, `#SPH` tanpa apa-apa. Harus dibalas
   petunjuk format, bukan diam dan bukan error mentah.
2. **Format berantakan tapi niatnya jelas** — huruf besar-kecil campur
   (`#sToK`), spasi setelah tanda pagar (`# STOK`), hashtag di baris kedua
   (pengantar dulu, `#BUKTI SJ-1` di bawahnya), spasi berlebih.
3. **`#SPH` dengan pemisah salah** — kurang/lebih dari 4 bagian, diskon tanpa
   tanda `%`, diskon di atas plafon SKU, qty nol atau negatif.
4. **Nomor/kode yang tak ada** — `#STOK KODENGAWUR`, `#KIRIM SJ-TIDAK-ADA`,
   `#APPROVE APR-9999`. Harus dibalas jelas, bukan diam.
5. **Melangkahi urutan** — `#BUKTI` sebelum `#BAST`, `#KIRIM` dua kali untuk SJ
   yang sama, `#APPROVE` untuk yang sudah disetujui.
6. **Nama di balasan** — kalau balasannya menyebut nama pengirim, pastikan
   namanya benar dan bukan `undefined`/kosong.

### Bukan bug (hashtag)

- **Pengirim tak dikenal → bot DIAM total.** Itu gerbang anti-spam yang
  disengaja, bukan kerusakan. Hasilnya `skipped: "unknown-sender"` dan
  `replied: 0`. Empat gerbang berbeda, sumber identitasnya beda-beda —
  tabelnya ada di `scripts/qa/README.md`.
- **`#BAST` ditolak dengan "belum ditandai TERIMA".** Benar. Langkah *terima* itu
  web-only (menu Shipping) dan **tak punya hashtag**, jadi rantai lapangannya:
  `#KIRIM` → *(admin tandai terima di web)* → `#BAST` → `#BUKTI`.
- **`#KLAIM` tanpa foto ditolak.** Wajib ada lampiran.
- **`#KLAIM` berfoto → "services/ai tak terjangkau ... status 503".** OCR-nya
  memanggil `services/ai` yang tak jalan di laptop kalian. Yang penting: ia
  **dibalas sopan**, tidak membuat proses mati. Kalau sampai bikin batch
  berhenti atau tak ada balasan sama sekali → **itu bug, laporkan.**
- **`#TICKET` `#FORECAST` `#TTF` `#SJ` tidak berbuat apa-apa.** Sengaja tak
  pernah diaktifkan.

Selesai menguji, **kembalikan `WA_INBOUND_PROCESS=false`** dan bersihkan:

```bash
psql -d wrg_os_dev -c "DELETE FROM wa_message WHERE input_hash LIKE 'uji-%'"
```

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
