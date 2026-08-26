# Runbook — Promosi batch magang (43 fitur / 33 menu) ke prod

Dikerjakan **di Mac mini**. Fase 0 & 2 sudah selesai di laptop; dokumen ini
memuat Fase 1 (geladi) dan Fase 3 (eksekusi).

> **Status: Fase 1 SELESAI di Mac mini, 26 Agu 2026 — lolos.** 43 pending → 43
> apply bersih dalam 1,4 detik · smoke `GAGAL: 0` · sim-hashtag `error: 0`. Prod
> tak tersentuh (`schema_migrations` tetap 113, repo prod tetap `main`). Angka
> acuan di tiap langkah di bawah sudah diganti dengan hasil terukur, bukan
> perkiraan. **Fase 3 menunggu persetujuan eksplisit Pak Husni.**

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

**Harapan: 43 berkas pending** (`082`–`092`, `115`–`119`, `127`–`154`). Kalau
jumlahnya beda jauh, **stop** — berarti asumsi runbook ini sudah basi.

> **Terverifikasi 26 Agu 2026: tepat 43.** Catatan kecil supaya tak bikin panik —
> `084` **tidak** muncul di daftar pending, dan itu wajar: rentang `082`–`092`
> berisi 10 berkas, bukan 11. Total tetap 10 + 5 + 28 = 43.

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
> ```bash
> psql -d wrg_os_geladi -c "
> INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source, updated_at, catatan)
> SELECT ai.id::bigint, 'KEDIRI', 25, 'manual', now(), 'baris uji Fase 1 — bukan data gudang'
>   FROM accurate_item ai WHERE COALESCE(ai.no,'') <> '' ORDER BY ai.no LIMIT 5
>   ON CONFLICT (item_id, warehouse_kode) DO NOTHING;"
> ```
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
