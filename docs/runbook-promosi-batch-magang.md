# Runbook — Promosi batch magang (43 fitur / 33 menu) ke prod

Dikerjakan **di Mac mini**. Fase 0 & 2 sudah selesai di laptop; dokumen ini
memuat Fase 1 (geladi) dan Fase 3 (eksekusi).

> **Status: Fase 1 SELESAI di Mac mini, 26 Agu 2026 — lolos.** 43 pending → 43
> apply bersih dalam 1,4 detik · smoke `GAGAL: 0` · sim-hashtag `error: 0`. Prod
> tak tersentuh (`schema_migrations` tetap 113, repo prod tetap `main`). Angka
> acuan di tiap langkah di bawah sudah diganti dengan hasil terukur, bukan
> perkiraan. **Fase 3 menunggu persetujuan eksplisit Pak Husni.**

> ## 🔁 Fase 1 PERLU DIULANG (per 29 Agu 2026)
>
> Bukan karena ada yang rusak — karena **yang diuji sudah bergerak**. Sejak
> geladi 26 Agu, `dev` menerima **43 commit** lagi (mayoritas perbaikan bug hasil
> sesi QA jalur tulis magang), sehingga:
>
> - migrasi pending **43 → 46** (`156`, `158`, `159` menyusul)
> - bukti **smoke & sim-hashtag 26 Agu jadi basi** untuk kode — 43 commit itu
>   menyentuh kode aplikasi, dan smoke Fase 1 menguji kode per 26 Agu
>
> Yang sudah diverifikasi ulang di laptop 29 Agu (rinciannya di Fase 1 langkah 3):
> geladi rantai 46 migrasi di atas skema `main` **lolos bersih & idempoten**,
> pindai risiko bersih, satu-satunya tabel lama yang disentuh cuma `sales_doc`
> (dua kolom nullable). Jadi **sisi database sudah rendah risiko dan terbukti**.
>
> Yang **belum** bisa diverifikasi dari laptop: jumlah pending otoritatif dari
> `schema_migrations` prod, dan smoke permukaan baca terhadap salinan data prod.
> Dua-duanya butuh Mac mini. Mac mini tidak terlihat di `tailscale status` dari
> laptop, jadi ini tak bisa dititipkan — harus dijalankan di sana.
>
> **Ulangi Fase 1 langkah 2–7.** Langkah 4 (apply) & 5 (smoke) yang paling
> penting; langkah 3 sudah punya angka pembanding baru (46).

> ## ⛔ GERBANG WAJIB
>
> **JANGAN merge `dev` → `main` sebelum Pak Husni menyatakan lolos uji.**
>
> Fase 1 hanya menyiapkan bukti. Setelah Fase 1 selesai, **berhenti**, laporkan
> hasilnya, dan tunggu persetujuan eksplisit. Fase 3 baru boleh dimulai setelah
> itu. Merge ke `main` memicu auto-deploy dalam ≤2 menit
> (`scripts/ops/auto-deploy.sh`, poller launchd 120 dtk) — tidak ada langkah
> "batal" setelah itu selain rollback.

---

## Kenapa hati-hati, dan kenapa tidak perlu panik

43 fitur ini **belum pernah dijalankan** sebelum 26 Agu 2026. Tapi risikonya
sudah diukur, dan sebagian besar kekhawatiran awal ternyata tidak berlaku:

| Yang dikhawatirkan | Fakta terukur |
|---|---|
| Blast WA ke grup live | **Tidak terjadi.** 11 job cron baru **semuanya default `false`** (`GA_HELPDESK_*`, `VEHICLE_ALERT`, `LPSE_TENDER_REMINDER`, `IT_TICKET_SLA`, `ED_WATCH`, `PREVISIT_CHECK`, `PM_KALIBRASI_REMINDER`, `GA_MAINTENANCE_*`, `ACCURATE_STOCK_SYNC`). Merge kode tidak menyalakan apa pun. |
| Migrasi merusak data prod | **Tidak menyentuh data lama.** 43 migrasi aditif. Hanya 4 statement terdeteksi "destruktif" dan semuanya jinak: 3× `DROP CONSTRAINT IF EXISTS` (untuk melebarkan CHECK) di `082`/`083`/`144`, dan 1× `DROP COLUMN IF EXISTS eta_date` di `140` pada `shipment_tracking` — tabel yang **belum ada** di prod (dibuat `138` di batch yang sama). |
| Kerjaan KSO yang live ter-revert | **Sudah diverifikasi utuh** saat sync (#1048): 0 berkas `main` hilang, penanda `penagihan_tes` 7=7, `BELI_REAGEN` 24=24, `kso_faskes_reagen` 10=10, dan Paritas Simulator KSO 341/341. |
| 33 menu langsung nongol ke semua user | **Jauh lebih sempit dari dugaan.** Dari 32 item menu baru di `nav.ts`, hanya **5** yang punya prop `show` dan bisa tampil sebelum Sync Fitur: `/dana-ops`, `/ga-reporting`, `/inventory-relocations`, `/purchase-forecast`, `/vendor-management`. Kelimanya ber-gate legacy `admin \|\| superuser \|\| is_hod` (purchase-forecast + `direktur`/title `hod*`) — **tak ada yang terbuka ke AM biasa**. 27 sisanya tidak punya `show`, jadi `nav.ts:391` membuatnya **tidak tampil** sampai diberi izin eksplisit. |

**Yang benar-benar belum teruji**, dan jadi alasan Fase 1 ada:

1. ~~**6 berkas repo baru membaca mirror Accurate yang besar**~~ — **SUDAH
   DIUJI, LOLOS** (Fase 1, 26 Agu 2026). `cek.ts` + `inbound-cek.ts` ternyata
   **bukan route HTTP** (`detectCek`/`handleCekQuery` = handler hashtag WA), jadi
   porsinya langkah 6, bukan smoke. Empat sisanya kena volume prod penuh
   (`accurate_item` 5.825 · `accurate_invoice_item` 11.875 · SO 3.385 · DO
   3.329 · `product_pricelist` 1.042):

   ```
   /stock/warehouses  200  3,9 ms   /stock/branch         200  32 ms (5.825 baris)
   /stock/batch       200  4,4 ms   /stock/branch/summary 200  12 ms
   /purchase-forecast 200  3,4 ms   /forecast/suggestions 200  3,2 ms
   ```

   Smoke total **7,9 detik untuk 234 route** — tak ada satu pun endpoint
   200-tapi-lambat. Kekhawatiran "100–300× lipat bikin lambat" tidak terbukti.
   Catatan: `GET /sph` balas 404 dan itu **benar** — route itu POST-only.
2. **Jalur tulis (POST/PATCH/DELETE) nol cakupan.** Di situ error FK/constraint
   muncul begitu orang memasukkan data. Tidak tertutup runbook ini — serahkan ke
   tim magang lewat UI setelah fitur dibuka (Fase 4).
3. **Endpoint detail** belum pernah dieksekusi karena tabelnya kosong. Terukur
   di salinan prod: **43** yang tak teruji, dan semuanya **memang** tabel kosong
   hari-1 (lihat gerbang langkah 5 — angka 42 di bawah bukan pembanding yang
   sah).

Hasil uji di dev (`scripts/qa/smoke-api-read.mjs`):

```
route tanpa param : 181  → 2xx=169  non-2xx-sesuai-harapan=12
route :id         :  53  → 2xx=8    tak-teruji=42
GAGAL             : 0
```

> ### ⚠️ Angka dev di atas BUKAN pembanding yang sah
>
> Dua alasan, keduanya terukur saat Fase 1:
>
> 1. **Premisnya terbalik.** `wrg_os_dev` punya baris fixture di tabel-tabel
>    43 fitur baru itu (disemai tim magang), sementara prod hari-1 **kosong** di
>    situ. Jadi justru dev yang bisa menguji lebih banyak endpoint detail — bukan
>    prod. Berharap `tak-teruji` *turun* di salinan prod itu salah sejak
>    premisnya, bukan cuma sulit diukur.
> 2. **Tak bisa direproduksi di Mac mini.** `wrg_os_dev` di sana kosong/basi —
>    `schema_migrations`-nya tidak ada sama sekali, dan smoke ke DB itu balas 500
>    beruntun (`crm_account`, `feature`, `access_group` tak ada). Angka 42 datang
>    dari lingkungan lain.
>
> Pembanding yang benar untuk Fase 1 adalah **salinan data prod**, dan angkanya
> ada di gerbang langkah 5.

---

## Kerjaan owner TIDAK bisa dipromosikan terpisah dari batch ini

Aturannya (29 Agu 2026): hanya kerjaan `DevWRG` sendiri — ditandai label GitHub
**`owner`** — yang boleh lanjut ke `main`; kerjaan magang berhenti di `dev`.

**Tapi aturan itu tak bisa ditegakkan dengan memilih PR**, karena dua hal:

**1. Promosi memindahkan SELURUH isi `dev`, bukan per-PR.** Per 29 Agu sudah ada
11 PR magang ter-merge ke `dev`. Promotion PR apa pun sekarang akan menyeret
semuanya ikut — label `owner` tak menahan apa pun.

**2. Sebagian kerjaan owner DIBANGUN DI ATAS batch magang.** Diperiksa langsung:
migrasi `159_installation_link_existing.sql` (F22, #1096, label `owner`)
mereferensi `teknisi_capacity` dan mengubah `installation_unit` —

| Tabel | Asal | Ada di `main`? |
|---|---|---|
| `accurate_item` | migrasi awal | ✅ ada |
| `accurate_customer` | migrasi awal | ✅ ada |
| `teknisi_capacity` | `136` (batch magang) | ❌ **tidak ada** |
| `installation_unit` | `130` (batch magang) | ❌ **tidak ada** |

Jadi cherry-pick F22 ke `main` akan menghasilkan migrasi yang `ALTER TABLE` pada
tabel yang tak ada → migrasi gagal → **deploy prod mati**, karena auto-deploy
meng-apply migrasi otomatis. Ini bukan preferensi arsitektur, ini dependensi
keras.

**Konsekuensinya:** F22 hanya bisa naik BERSAMA batch magang, atau menunggu.
Yang bisa dipromosikan sendiri hanyalah kerjaan owner tanpa migrasi dan tanpa
sentuhan ke tabel batch magang — mis. #1076 yang cuma mengubah
`.github/workflows/`. Bahkan untuk itu, perlu disadari merge ke `main` memicu
auto-deploy penuh (pull → build → restart pm2), jadi mem-bounce prod untuk
perubahan yang tak punya efek runtime di server sama sekali.

Sebelum menyusun promotion PR, periksa dulu tiap migrasi kerjaan owner:

```bash
grep -oE "REFERENCES [a-z_]+|ALTER TABLE [a-z_]+" infra/postgres/init/<berkas>.sql | sort -u
# lalu untuk tiap tabel:
git grep -q "CREATE TABLE.*\b<tabel>\b" origin/main -- infra/postgres/init/ \
  && echo "ada di main" || echo "TIDAK ada di main — tak bisa dipromosikan sendiri"
```

---

## ⚠️ Tiga hal yang JANGAN dilakukan

**1. JANGAN `git checkout dev` di repo prod.** Repo prod di Mac mini harus tetap
di `main`. Pernah terjadi: auto-deploy berhenti karena repo prod ditinggal di
feature branch, dan perubahan uncommitted tersangkut di stash. Untuk menjalankan
kode `dev`, pakai **worktree terpisah** (§Fase 1 langkah 1). Repo prod ada di
`~/DevWRG/wrg-os`.

**2. JANGAN jalankan `migrate.sh` dari checkout `main`.** `INIT_DIR` di skrip itu
**relatif ke CWD**, dan berkas `127`–`154` tidak ada di `main`. Dijalankan dari
sana, 43 migrasi itu tidak akan terlihat sebagai pending. Jalankan dari worktree
`dev`.

**3. JANGAN merge sebelum gerbang di atas dilewati.**

---

# FASE 1 — Geladi di salinan data prod

Tujuan: membuktikan 43 migrasi apply bersih **pada data prod sungguhan**, dan
menutup celah 6 berkas yang membaca mirror Accurate. Tidak menyentuh prod.

### 1. Worktree `dev` terpisah (bukan checkout di repo prod)

```bash
cd ~/DevWRG/wrg-os                 # repo prod (default WRG_PROD_DIR)
git fetch origin
git worktree add ~/wrg-os-geladi origin/dev
cd ~/wrg-os-geladi
git log --oneline -1               # pastikan ini commit dev terbaru
```

> Repo prod ada di **`~/DevWRG/wrg-os`** (lihat `WRG_PROD_DIR` di
> `scripts/ops/auto-deploy.sh:30`), bukan `~/wrg-os`. Repo itu tetap di `main`
> sepanjang Fase 1. Periksa:
> `git -C ~/DevWRG/wrg-os branch --show-current` → harus `main`.

### 2. Salin data prod ke DB geladi

```bash
pg_dump -d wrg_os_prod -Fc -f ~/geladi-prod.dump      # nama DB: cek .env.prod
createdb wrg_os_geladi
pg_restore -d wrg_os_geladi --no-owner --no-privileges ~/geladi-prod.dump
```

Catat volume nyatanya — angka ini yang membuat geladi bermakna:

```bash
psql -d wrg_os_geladi -Atc "
select 'accurate_item='||count(*) from accurate_item
union all select 'accurate_invoice_item='||count(*) from accurate_invoice_item
union all select 'accurate_sales_order='||count(*) from accurate_sales_order
union all select 'accurate_delivery_order='||count(*) from accurate_delivery_order
union all select 'product_pricelist='||count(*) from product_pricelist"
```

### 3. Lihat apa yang pending, sebelum apply

```bash
cd ~/wrg-os-geladi
DATABASE_URL=postgres:///wrg_os_geladi bash scripts/db/migrate.sh --dry-run
```

> ## ⚠️ ANGKA 43 SUDAH BASI — hitung ulang, jangan percaya angka beku
>
> **Per 29 Agu 2026 pending-nya 46, bukan 43.** `dev` terus menerima migrasi baru
> setelah runbook ini ditulis: `156_ga_asset_assignment_shared_fix`,
> `158_purchase_order_po_number_unique` (#1090), `159_installation_link_existing`
> (#1096). Angka itu akan terus bertambah tiap ada PR ber-migrasi masuk `dev`.
>
> Instruksi "stop kalau jumlahnya beda" di bawah TETAP berlaku — tapi
> pembandingnya bukan 43, melainkan hasil hitung sendiri **tepat sebelum mulai**
> (perintahnya di bawah kotak ini). Angka itu yang harus cocok dengan hasil
> `migrate.sh --dry-run`. Kalau dua-duanya sama, lanjut. Kalau beda, ada yang tak
> sinkron — baru berhenti.

Hitung ulang pending sebelum mulai:

```bash
git fetch origin
comm -13 \
  <(git ls-tree -r origin/main --name-only infra/postgres/init/ | sed 's|.*/||' | sort) \
  <(git ls-tree -r origin/dev  --name-only infra/postgres/init/ | sed 's|.*/||' | sort) \
  | wc -l
```

**Harapan: sebanyak hasil hitung di atas** (dulu 43: `082`–`092`, `115`–`119`,
`127`–`154`; kini ditambah `156`, `158`, `159`). Kalau
jumlahnya beda jauh, **stop** — berarti asumsi runbook ini sudah basi.

> **Terverifikasi 26 Agu 2026: tepat 43.** Catatan kecil supaya tak bikin panik —
> `084` **tidak** muncul di daftar pending, dan itu wajar: rentang `082`–`092`
> berisi 10 berkas, bukan 11. Total tetap 10 + 5 + 28 = 43.

#### Hitung ulang 29 Agu 2026 — 46, dan kali ini diuji bukan cuma dihitung

Angka 46 sudah **diverifikasi dengan geladi rantai penuh di laptop**, bukan
sekadar hasil `comm` antar-branch:

| Yang diukur | Hasil |
|---|---|
| Migrasi dev-only (git) | **46** |
| Geladi: skema setara `main` | 114 ter-apply, rc=0 |
| Geladi: 46 di atasnya | **46/46 bersih, rc=0**, total 160 |
| Jalankan runner ulang | "tidak ada migrasi pending" → idempoten |
| Tabel baru yang dibuat | 61 |

Cara mengulang geladi ini tanpa data prod (aman dijalankan di laptop mana pun):
`001_extensions.sql` **harus dilewati** — ia memuat `CREATE DATABASE langfuse`
yang tak bisa jalan di dalam transaksi, dan memang berkas bootstrap, bukan
bagian rantai. Buat extension-nya manual, tandai `001` sebagai applied, lalu
jalankan runner dari worktree `main` dan disusul worktree `dev`.

**Tiga migrasi ini BELUM ikut geladi Fase 1 (26 Agu) dan belum pernah jalan di
`wrg_os_dev` — satu-satunya yang benar-benar perawan:**

| Migrasi | Masuk `dev` | Isi | Penilaian |
|---|---|---|---|
| `156_ga_asset_assignment_shared_fix` | 27 Agu | `ADD COLUMN is_shared_snapshot boolean NOT NULL DEFAULT false` + `DROP INDEX` lalu buat ulang unique index berpredikat | Aman — `ga_asset_assignments` lahir di batch ini (`088`), jadi di prod tabelnya kosong |
| `158_purchase_order_po_number_unique` | 29 Agu | `CREATE UNIQUE INDEX ON purchase_order (po_number)` | Aman — `purchase_order` lahir di `143` (dalam batch). Unique index pada tabel berisi data BISA gagal, tapi di prod tabelnya belum ada |
| `159_installation_link_existing` | 29 Agu | 3 FK nullable ke `installation_unit` + 3 partial index | Aman — additive, semua nullable; `installation_unit` (`130`) & `teknisi_capacity` (`136`) juga lahir di batch ini |

#### Pindai risiko atas ke-46 (29 Agu 2026)

| Pemeriksaan | Hasil |
|---|---|
| `ADD COLUMN … NOT NULL` tanpa `DEFAULT` (langgar aturan 2) | **0** |
| `BEGIN`/`COMMIT` milik berkas sendiri | **0** |
| `CREATE TABLE` tanpa `IF NOT EXISTS` | **0** (satu cocokan ternyata di dalam komentar) |
| `GRANT` yang perlu ditambah manual | **0** — `ALTER DEFAULT PRIVILEGES` di `039` + `157` sudah otomatis meliputi tabel baru |
| Pernyataan destruktif | 1 `DROP COLUMN` + 3 `DROP CONSTRAINT` + 1 `DROP INDEX` |
| **Tabel LAMA (sudah berisi data prod) yang disentuh** | **hanya `sales_doc`** |

Kelima pernyataan destruktif itu **semuanya menyasar tabel yang lahir di batch
ini**, jadi di prod mereka bekerja pada tabel kosong:

- `140` membuang `eta_date` dari `shipment_tracking` — kolomnya baru dibuat di
  `138`, di dalam batch yang sama, dan **nol referensi di kode `main`**. Prod tak
  pernah melihat kolom itu ada.
- `082` (`warehouse`), `083` (`item_stock_batch`), `144` (`shipment_tracking`),
  `156` (`ga_asset_assignments`) — semua tabelnya lahir di batch.

Satu-satunya sentuhan ke tabel lama adalah `152_sph_generator` ke `sales_doc`
(dibuat `003`, ada data di prod), dan isinya cuma dua kolom **nullable**:
`hod_reviewed_by text` dan `hod_reviewed_at timestamptz`. Patuh expand-contract.

> **Jebakan metodologi — jangan ulangi.** Pindaian pertama gue melaporkan "tak
> ada" untuk kelima pemeriksaan, dan itu **palsu**: daftar 46 nama berkas
> dilewatkan sebagai satu argumen (zsh tidak memecah `$VAR` tak berkurung), jadi
> ugrep membacanya sebagai satu nama berkas — "File name too long" — dan nol
> berkas terpindai. Selalu pasang **kontrol positif** (mis. hitung berkas yang
> memuat `CREATE TABLE`; harus 36, bukan 0) sebelum memercayai hasil "bersih".
> Pola awal gue juga tak mencakup `DROP INDEX`/`DROP CONSTRAINT` — ketahuan cuma
> karena `156` dibaca manual.

### 4. Apply, dan catat durasinya

```bash
time DATABASE_URL=postgres:///wrg_os_geladi bash scripts/db/migrate.sh
```

Durasi ini = perkiraan lama jendela saat Fase 3 langkah 3. Kalau ada yang GAGAL,
salin pesannya utuh — itu temuan Fase 1 yang paling berharga.

> **Terukur 26 Agu 2026: 43/43 apply bersih dalam 1,4 detik.** Jendela Fase 3
> jauh lebih sempit dari dugaan. Verifikasi sesudahnya: `schema_migrations`
> 113 → 156 (delta tepat 43), dan `--dry-run` ulang balas "tidak ada migrasi
> pending".

### 5. Smoke permukaan baca terhadap data prod — **langkah terpenting**

```bash
cd ~/wrg-os-geladi
rm -f apps/api/tsconfig.tsbuildinfo        # buildinfo basi bikin tsc exit 0 tanpa emit
pnpm install --frozen-lockfile
pnpm --filter @wrg/api build
DATABASE_URL=postgres:///wrg_os_geladi SMOKE_PORT=4199 node scripts/qa/smoke-api-read.mjs
```

Di sini 6 berkas berisiko itu akhirnya kena volume nyata. Hanya GET, tak ada
tulis, scheduler mati, WA dry-run.

**Yang dinilai:**

- `GAGAL: 0` → lolos.
- 5xx apa pun → **temuan**, catat route + body-nya.
- Perhatikan durasinya. Endpoint yang menggantung puluhan detik itu temuan,
  walau statusnya 200.
- **Untuk `tak-teruji`, yang dinilai BUKAN angkanya turun** — tapi apakah tiap
  entri yang tersisa benar-benar tabel kosong. Sejak #1051, harness memisahkan
  label `"kosong"` dari `"tak ada kunci id"`; kalau yang kedua muncul, itu
  titik-buta harness dan **wajib** ditelusuri, bukan diterima.

**Angka acuan di salinan data prod (terukur 26 Agu 2026, sesudah #1051):**

```
route tanpa param : 181  → 2xx=170  non-2xx-sesuai-harapan=12
route :id         :  53  → 2xx=9    tak-teruji=43
GAGAL             : 0
```

43 sisanya semuanya tabel kosong hari-1; label `"tak ada kunci id"` tak menyala
sama sekali.

> ### Kalau `tak-teruji` = 46, berarti #1051 belum masuk
>
> Sebelum #1051, `ambilId` punya dua kekeliruan menumpuk: mengambil array
> **pertama** di objek (di `/customers/revenue` itu `months`, di `/npk/scores`
> itu `aspect_order` — array string, bukan baris data) dan hanya menerima field
> bernama `id` **persis** (payload nyata pakai `customer_id`, `am_id`, dst).
>
> Akibatnya 4 route list yang **berisi data prod** dilabeli `(list kosong)` —
> `/customers` (260 baris), `/sales-analytics/per-am` (14), `/npk/scores` +
> `/npk/am/scores`. Label itu menyamarkan titik-buta harness sebagai tabel
> kosong. Tiga endpoint detail yang sebenarnya sehat karena itu tak pernah
> dipukul; dibuktikan manual di volume prod:
>
> ```
> /customers/12150/monthly              200   17 ms
> /sales-analytics/per-am/15/drilldown  200   33 ms
> /accurate/vendors/10650/detail        200  121 ms
> ```
>
> Jangan pakai angka `tak-teruji` sebagai gerbang rilis sebelum #1051 ada di
> `dev`.

**Non-2xx yang BENAR dan jangan dikira cacat** (terlihat saat memukul endpoint
detail secara manual):

- `/npk/scores/<am_id>` → **404** `"HoD tidak ditemukan"` — salah ruang id, AM
  bukan HoD.
- `/npk/am/scores/<am_id>` → **403** `"Anda hanya boleh membuka NPK sendiri"` —
  gerbang otorisasi bekerja; service-token bukan AM itu.
- `/customers/<slug>/monthly` → **400** `"id invalid"` — `/customers` keluar slug
  (`rsup-mandalika`) sementara handler ini minta id numerik Accurate. Sumber id
  yang benar: `/customers/revenue`. Dua ruang id berbeda, bukan bug.

### 6. Smoke command hashtag WA terhadap data prod

Data prod, jadi **wajib `--baca-saja`** (skenario tulis akan memutuskan approval
sungguhan). Pengirim di-override ke AM yang benar ada di roster:

```bash
AM_WA=...                          # nomor WA AM yang ADA di master_user, mis. 6281...
AM_NAMA=...                        # nama PERSIS seperti di master_user.nama
QA_AM_WA="$AM_WA" QA_AM_NAMA="$AM_NAMA" \
  DATABASE_URL=postgres:///wrg_os_geladi \
  node scripts/qa/sim-hashtag.mjs --baca-saja
```

Tanpa override, nomor fixture tidak ada di roster prod → semua command baca
membalas hening, dan itu terbaca seperti kerusakan.

AM yang dipakai saat Fase 1: **Ari Kurnia Yuda** (`am_id` 11, pilot AM-scope).
Ambil pasangan nomor+nama yang sah langsung dari roster:

```bash
psql -d wrg_os_geladi -Atc \
  "SELECT am_id, nama, wa_number FROM master_user
    WHERE role ILIKE '%AM%' AND COALESCE(wa_number,'') <> '' ORDER BY am_id LIMIT 5;"
```

> ### ⛔ JANGAN jalankan `seed-dev.sql` yang disarankan skrip ini
>
> Kalau prasyarat data belum lengkap, `sim-hashtag.mjs` mencetak saran:
> `psql -f scripts/db/seed-dev.sql` (+ `seed-dev-full.sql`). **Jangan diikuti di
> DB geladi.** `seed-dev.sql` menimpa `master_user` dengan roster **demo** —
> begitu dijalankan, salinan prod-mu tak lagi setia dan seluruh sisa Fase 1
> kehilangan maknanya.
>
> Yang benar: sisipkan **hanya** yang kurang. Saat Fase 1, satu-satunya
> penghalang adalah `item_stock_branch` gudang KEDIRI kosong (`product_pricelist`
> prod sudah memenuhi syarat #SPH — 1.042 baris). Cukup 5 baris dari item asli:
>
Sisipan minimal 5 baris KEDIRI (pengganti `seed-dev.sql` yang berbahaya):

```bash
psql -d wrg_os_geladi -c "
INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source, updated_at, catatan)
SELECT ai.id::bigint, 'KEDIRI', 25, 'manual', now(), 'baris uji Fase 1 — bukan data gudang'
  FROM accurate_item ai WHERE COALESCE(ai.no,'') <> '' ORDER BY ai.no LIMIT 5
  ON CONFLICT (item_id, warehouse_kode) DO NOTHING;"
```
>
> `source` wajib salah satu dari `manual|import|accurate` — ada CHECK constraint
> yang menolak nilai lain (skemanya menjaga diri; jangan dilawan).
>
> Sesudah ini DB geladi **bukan salinan prod murni lagi**. Catat itu di laporan.

**Angka acuan (terukur 26 Agu 2026):**

```
total=28 baca  cocok=23  beda=5  error=0  (14 skenario tulis dilewati)
```

`error=0` itu yang dinilai — nol exception. Kelima `beda` semuanya **kekurangan
fixture, bukan cacat kode**, dan wajar hari-1:

| Skenario `beda` | Sebabnya |
|---|---|
| `install · teks kosong` | persona fixture `Joko Fixture` tak ada di roster prod → gerbang pengirim menyala **sebelum** validasi format |
| `approve · kode salah format` | idem — approver fixture tak dikenal, jadi hening `"unknown-approver"` alih-alih pesan format |
| `bast · SJ baru dikirim` | `shipment_tracking` kosong hari-1 → SJ-QA-001 tak ada |
| `bukti · SJ belum BAST` | idem |
| `kirim · SJ sudah pernah dikirim` | idem — SJ-QA-002 tak ada |

Selesai, bersihkan:

```bash
psql -d wrg_os_geladi -c "DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%';"
```

### 7. Laporkan, lalu BERHENTI

Kirim ke Pak Husni:

- jumlah pending & hasil apply (langkah 3–4) + **durasi**
- ringkasan `smoke-api-read.mjs` (langkah 5) — `GAGAL`, `2xx`, `tak-teruji`
- ringkasan `sim-hashtag.mjs --baca-saja` (langkah 6)
- daftar temuan, kalau ada

**Tunggu persetujuan eksplisit. Jangan lanjut ke Fase 3.**

Bersih-bersih boleh menyusul (`dropdb wrg_os_geladi`,
`git worktree remove ~/wrg-os-geladi`) — tapi **tahan dulu** sampai Fase 3
selesai; worktree-nya masih dipakai untuk apply migrasi.

---

# FASE 3 — Eksekusi

> **Hanya setelah Pak Husni menyatakan lolos.** Kerjakan di jam sepi.

### Urutan sengaja dibalik: migrasi DULU, kode belakangan

Migrasinya **aditif**, jadi selama kodenya belum naik **tak ada yang
membacanya** — aman diterapkan lebih dulu. Kalau dibalik (kode dulu, migrasi
ditahan pakai `WRG_DEPLOY_BLOCK_ON_PENDING=1`), hasilnya kombinasi terburuk: 33
menu baru muncul lalu semuanya 500 karena tabelnya belum ada.

Ini juga cocok dengan mesin yang sudah ada: deteksi pending auto-deploy
membandingkan berkas migrasi di `origin/main` vs `schema_migrations` prod. Kalau
sudah di-apply lebih dulu, saat merge terjadi auto-deploy melihat **0 pending**
dan hanya menaikkan kode.

### 1. Backup eksplisit

```bash
pg_dump -d wrg_os_prod -Fc -f ~/DevWRG/ops/db-backups/pra-promosi-magang-$(date +%Y%m%d-%H%M).dump
ls -lh ~/DevWRG/ops/db-backups/ | tail -3
```

`migrate.sh --backup` juga bikin backup sendiri; yang ini backup kedua yang
namanya jelas, untuk rollback.

### 2. Konfirmasi pending di PROD (dari worktree dev)

```bash
cd ~/wrg-os-geladi
MIGRATE_DATABASE_URL=postgres:///wrg_os_prod bash scripts/db/migrate.sh --prod --dry-run
```

`MIGRATE_DATABASE_URL` dipakai supaya tidak bergantung pada `.env.prod` yang
tidak ada di worktree. **Harapan: 43 pending, sama seperti Fase 1 langkah 3.**
Beda → stop.

### 3. Apply ke prod

```bash
cd ~/wrg-os-geladi
MIGRATE_DATABASE_URL=postgres:///wrg_os_prod bash scripts/db/migrate.sh --prod --backup
```

### 4. Pastikan prod masih sehat — SEBELUM menyentuh `main`

Kodenya masih yang lama, jadi ini membuktikan migrasi tidak mengganggu apa pun:

```bash
TOK=$(grep -E '^API_SERVICE_TOKEN=' ~/DevWRG/wrg-os/.env.prod | cut -d= -f2-)
for p in /health /dashboard/overview /sales/revenue /customers/revenue /kso/produktivitas; do
  printf "%-28s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' -H "x-service-token: $TOK" "http://localhost:4100$p")"
done
```

Semua harus 2xx. Kalau ada yang berubah jadi 5xx → **rollback (§bawah), jangan
merge.**

Cek juga menu lama di browser (Sales Overview, WatchPoint, KSO) masih normal.

### 5. Merge `dev` → `main`

Dilakukan Pak Husni. Auto-deploy akan mengambilnya dalam ≤2 menit. Pantau:

```bash
tail -f ~/DevWRG/ops/auto-deploy.log       # WRG_DEPLOY_LOG, auto-deploy.sh:31
pm2 list
```

Setelah deploy: `pm2 list` harus menunjukkan `wrg-prod-api` dan `wrg-prod-web`
online (bukan `errored`/restart-loop).

**Verifikasi isi, bukan status PR.** Sudah 2× terjadi PR berstatus MERGED tapi
isinya tidak mendarat di `main`/`dev`. Jangan percaya papan PR:

```bash
cd ~/DevWRG/wrg-os
git fetch origin
git show origin/main:apps/api/src/repo/inbound.ts | grep -c INBOUND_HASHTAGS   # harus > 0
git cat-file -e origin/main:scripts/qa/smoke-api-read.mjs && echo "smoke ADA"
git show origin/main:apps/api/src/ai.ts | grep -c AI_TIMEOUT_MS                # harus > 0
```

### 6. LANGSUNG tekan "Sync Fitur" — ini jendela paparannya

Buka menu **Admin → Akses Grup → Sync Fitur**.

Kenapa harus segera: `seedMissingPermissions()` hanya memberi grant ke grup
**superuser**, jadi fitur baru tertutup untuk grup lain — **tetapi baris deny itu
baru ada setelah Sync Fitur ditekan.** Sebelum itu, fitur tanpa baris izin jatuh
ke gate identitas lama, yang komentarnya sendiri di `rbac.ts` mengakui "sering
permisif".

Besarnya jendela itu sudah diukur, dan tidak segenting kedengarannya: dari 32
item menu baru, hanya **5** yang punya prop `show` sehingga bisa tampil sebelum
Sync Fitur — `/dana-ops`, `/ga-reporting`, `/inventory-relocations`,
`/purchase-forecast`, `/vendor-management`. Kelimanya ber-gate legacy
`admin || superuser || is_hod`, jadi paling jauh terlihat oleh HoD, **bukan AM
biasa**. 27 menu sisanya tak punya `show`; per `nav.ts:391` ("Belum diatur →
`show`; tanpa `show` → tidak tampil") mereka memang tidak muncul sampai diberi
izin.

Jadi tetap tekan Sync Fitur segera, tapi kalau ada jeda beberapa menit, yang
terpapar cuma 5 menu ke kalangan HoD ke atas — bukan 33 menu ke semua orang.

Catatan: grup yang **belum punya baris izin sama sekali** sengaja dilewati
(menyemai satu baris deny ke grup kosong justru mengosongkan seluruh sidebar-nya).
Grup begitu tetap pakai gate lama sampai admin mengaturnya.

Verifikasi sesudahnya:

```bash
psql -d wrg_os_prod -Atc "
select count(*) filter (where can_view) as bisa_lihat,
       count(*) filter (where not can_view) as ditutup
from access_permission ap
join access_group g on g.id = ap.group_id and not g.superuser
join feature f on f.key = ap.feature_key
where f.key in ('ga-tickets','shipment-tracking','purchase-orders','vehicles','atk-master')"
```

`bisa_lihat` harus 0 untuk grup non-superuser.

### 7. Pastikan tak ada cron baru yang menyala

```bash
grep -E "GA_HELPDESK|VEHICLE_ALERT|LPSE_TENDER|IT_TICKET_SLA|ED_WATCH|PREVISIT|PM_KALIBRASI|GA_MAINTENANCE|ACCURATE_STOCK_SYNC" ~/DevWRG/wrg-os/.env.prod || echo "(tak ada → semuanya default false, benar)"
```

Semua 11 job baru default `false`. Yang **tidak boleh** ada di `.env.prod` adalah
salah satunya di-set `true` tanpa keputusan sadar.

### 8. Smoke prod

```bash
cd ~/wrg-os-geladi
DATABASE_URL=postgres:///wrg_os_prod SMOKE_PORT=4199 node scripts/qa/smoke-api-read.mjs
```

Hanya GET, scheduler mati, tak ada tulis — aman di prod. `GAGAL` harus 0.

### 9. Bersih-bersih

```bash
dropdb wrg_os_geladi
git -C ~/DevWRG/wrg-os worktree remove ~/wrg-os-geladi
rm -f ~/geladi-prod.dump
git -C ~/DevWRG/wrg-os branch --show-current   # pastikan masih `main`
```

---

## Rollback

**Kalau gagal di langkah 4 (setelah migrasi, sebelum merge)** — paling mudah,
karena `main` belum tersentuh:

```bash
pm2 stop wrg-prod-api wrg-prod-web
dropdb wrg_os_prod && createdb wrg_os_prod
pg_restore -d wrg_os_prod --no-owner --no-privileges ~/DevWRG/ops/db-backups/pra-promosi-magang-<stamp>.dump
pm2 restart ecosystem.config.cjs --only wrg-prod-api,wrg-prod-web --update-env
```

**Kalau gagal setelah merge** — revert kode dulu (auto-deploy akan menariknya),
DB-nya boleh dibiarkan karena aditif:

```bash
cd ~/DevWRG/wrg-os
SHA_MERGE=...                      # sha commit merge promosi (git log --oneline -5)
git revert -m 1 "$SHA_MERGE"
git push origin main
```

Tabel baru yang tertinggal tanpa pembaca tidak berbahaya. Jangan buru-buru
men-drop-nya — itu justru operasi destruktif yang selama ini kita hindari.

---

## Fase 4 — buka fitur satu-satu

Setelah prod stabil, buka lewat **Admin → Akses Grup**, per grup per fitur,
ditemani pemilik prosesnya. Jangan buka 33 sekaligus.

Prioritaskan fitur yang **jalur tulisnya** perlu divalidasi orang yang tahu alur
bisnisnya — itu satu-satunya celah yang tidak tertutup runbook ini.

### Dependensi data, bukan kode: Stock Gudang & ED Watch butuh CSV tim gudang

`item_stock_branch` dan stok batch **hanya** diisi importer CSV manual
(`scripts/db/import_stock_branch.py`, `import_stock_batch.py`). Sudah dilacak
saat Fase 1: **tak ada satu pun scheduler/cron yang memanggilnya** — dan itu
memang desainnya (data stok milik tim gudang, hidupnya di Excel; pola sama
Price Book / Klasifikasi Produk / KSO master).

Konsekuensinya, sesudah Fase 3 menu Stock Gudang & ED Watch akan tampil
`cakupan 0%` sampai ada yang menjalankan importer. Terukur di salinan prod:
`item_mirror` 5.825 · `item_ada_data` **0** · `cakupan_persen` **0**, dan 12
gudang semuanya `item_count: 0`.

**Ini bukan bug** — UI-nya sudah jujur: saat kosong ia menampilkan petunjuk
importer, dan membedakan "belum diisi" dari "stok habis" (sel CSV kosong ≠ `0`).
Tapi berarti Fase 4 untuk dua menu ini **diblokir sampai CSV opname tim gudang
tersedia**, bukan sampai izin grup dibuka. Jadwalkan permintaan CSV-nya lebih
awal.

---

## Catatan

- **`rev-list` masih bilang 69 commit `main` "belum ada" di `dev`.** Itu artefak
  squash-merge pada #1048 — isinya lengkap (diverifikasi berkas per berkas),
  hanya riwayat parent-nya yang diratakan. Konsekuensinya: `git merge origin/main`
  ke `dev` berikutnya akan bentrok lagi di `ci.yml` dan `pnpm-lock.yaml`. Jangan
  dibaca sebagai regresi.
- ~~**Yang belum diverifikasi dari laptop**~~ — sebagian sudah dicek di tempat
  saat Fase 1 (26 Agu 2026): nama DB prod **terkonfirmasi `wrg_os_prod`** (dari
  `DATABASE_URL` di `.env.prod`), dan repo prod memang di `~/DevWRG/wrg-os`.
  Masih perlu dicek saat Fase 3: path log auto-deploy.
- **`wrg_os_dev` di Mac mini kosong/basi** — tak punya `schema_migrations`, smoke
  ke DB itu balas 500 beruntun. Jangan pakai sebagai pembanding apa pun dari
  mesin itu; pakai salinan prod (`wrg_os_geladi`).
- **Sisa Fase 1 yang ditahan untuk Fase 3**: worktree `~/wrg-os-geladi` dan DB
  `wrg_os_geladi` (156 migrasi, plus 5 baris uji KEDIRI). Bersih-bersihnya
  (`dropdb wrg_os_geladi`, `git worktree remove ~/wrg-os-geladi`) baru setelah
  Fase 3 selesai.
- Referensi: `docs/MIGRATIONS.md`, `docs/AUTO-DEPLOY.md`, `scripts/qa/README.md`.
