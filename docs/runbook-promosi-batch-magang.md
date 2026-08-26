# Runbook — Promosi batch magang (43 fitur / 33 menu) ke prod

Dikerjakan **di Mac mini**. Fase 0 & 2 sudah selesai di laptop; dokumen ini
memuat Fase 1 (geladi) dan Fase 3 (eksekusi).

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

1. **6 berkas repo baru membaca mirror Accurate yang besar** — `cek.ts`,
   `inbound-cek.ts`, `forecast.ts`, `stock-batch.ts`, `stock-branch.ts`,
   `sph.ts`. Di `wrg_os_dev` cuma ada 12 `accurate_item` dan 40 SO/DO; prod
   ~5.800 dan ~11.800/11.900 — **100–300× lipat**. Query yang wajar di dev bisa
   lambat atau salah di prod.
2. **Jalur tulis (POST/PATCH/DELETE) nol cakupan.** Di situ error FK/constraint
   muncul begitu orang memasukkan data. Tidak tertutup runbook ini — serahkan ke
   tim magang lewat UI setelah fitur dibuka (Fase 4).
3. **42 endpoint detail** belum pernah dieksekusi karena tabelnya kosong.

Hasil uji di dev sebagai pembanding (`scripts/qa/smoke-api-read.mjs`):

```
route tanpa param : 181  → 2xx=169  non-2xx-sesuai-harapan=12
route :id         :  53  → 2xx=8    tak-teruji=42
GAGAL             : 0
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

**Harapan: 43 berkas pending** (`082`–`092`, `115`–`119`, `127`–`154`). Kalau
jumlahnya beda jauh, **stop** — berarti asumsi runbook ini sudah basi.

### 4. Apply, dan catat durasinya

```bash
time DATABASE_URL=postgres:///wrg_os_geladi bash scripts/db/migrate.sh
```

Durasi ini = perkiraan lama jendela saat Fase 3 langkah 3. Kalau ada yang GAGAL,
salin pesannya utuh — itu temuan Fase 1 yang paling berharga.

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
- Bandingkan `2xx` dan `tak-teruji` dengan baseline dev di atas. Jumlah
  `tak-teruji` **harus turun** dibanding 42 (tabel prod berisi data), dan tiap
  endpoint detail yang tadinya tak teruji sekarang benar-benar diuji.
- Perhatikan juga durasinya. Endpoint yang menggantung puluhan detik itu temuan,
  walau statusnya 200.

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
membalas hening, dan itu terbaca seperti kerusakan. Selesai, bersihkan:

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

---

## Catatan

- **`rev-list` masih bilang 69 commit `main` "belum ada" di `dev`.** Itu artefak
  squash-merge pada #1048 — isinya lengkap (diverifikasi berkas per berkas),
  hanya riwayat parent-nya yang diratakan. Konsekuensinya: `git merge origin/main`
  ke `dev` berikutnya akan bentrok lagi di `ci.yml` dan `pnpm-lock.yaml`. Jangan
  dibaca sebagai regresi.
- **Yang belum diverifikasi dari laptop**, harap dicek di tempat: nama DB prod
  (diasumsikan `wrg_os_prod`), path log auto-deploy, dan isi `.env.prod`.
- Referensi: `docs/MIGRATIONS.md`, `docs/AUTO-DEPLOY.md`, `scripts/qa/README.md`.
