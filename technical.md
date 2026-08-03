# Technical Notes — Local Dev Setup (wrg-os)

> Untracked, referensi teknis pribadi. Sumber kebenaran resmi tetap
> `docs/LOCAL-DEV.md` dan `CLAUDE.md` — file ini cuma ringkasan status +
> langkah lanjut yang sudah diverifikasi per 2026-07-28.

## Arsitektur singkat (lihat CLAUDE.md untuk detail penuh)

```
apps/api/     Hono + TypeScript → dist/index.js, port 4000 (dev) / 4100 (prod)
apps/web/     Next.js App Router, port 3000 (dev) / 3100 (prod), BFF proxy
services/ai/  Python FastAPI (uvicorn, .venv), port 8000 (dev) / 8100 (prod)
infra/postgres/init/*.sql   38 file migrasi berurut, auto-apply via docker compose
```

Postgres via Docker: host port **5433** (bukan 5432 default!), db name `wrg_os`.

## Status: SETUP SELESAI, project jalan (2026-07-28)

```
docker --version   → Docker version 29.6.2, build dfc4efb   ✅
docker ps          → sukses, engine responsif                ✅
wsl --version      → WSL version 2.7.11.0                    ✅
node --version     → v25.6.1 (pindah dari v20.20.2 via nvm)  ✅
pnpm --version     → 11.5.2                                  ✅
```

api :4000, web :3000, ai :8000 — semua jalan. DB ter-seed. Admin user dibuat
(`you@wahanalifeline.co.id` / `rahasia123`).

## Masalah yang ditemukan saat eksekusi + solusinya (baca ini kalau setup ulang)

### 1. pnpm@11.5.2 butuh Node ≥22.13, bukan ≥20
Node aktif waktu itu v20.20.2 (satisfy `engines.node >=20.0.0` project, tapi
TIDAK cukup untuk pnpm binary-nya sendiri). Laptop ini pakai **nvm-windows**
dan sudah ada Node v25.6.1 ter-install (`nvm list`):
```bash
nvm use 25.6.1
node --version   # harus v25.6.1
```
Kalau butuh Node lain di masa depan: `nvm install <versi>` lalu `nvm use <versi>`.

### 2. Node 25 tidak lagi bundle corepack
`corepack enable` / `corepack prepare` error `corepack: command not found`
(atau kalau dipaksa jalan di Node <22, error `ERR_UNKNOWN_BUILTIN_MODULE:
node:sqlite`). Solusi yang benar-benar jalan:
```bash
npm install -g pnpm@11.5.2
pnpm --version   # verifikasi 11.5.2
```

### 3. Setup .env
```bash
cp .env.example .env
```
Sudah diisi di `.env` (working tree, jangan commit):
```
PG_PASSWORD=wrg_dev_pw
DATABASE_URL=postgres://wrg:wrg_dev_pw@localhost:5433/wrg_os
```
**Jangan** pakai `@postgres:5432` (itu untuk kalau app JUGA jalan di dalam
Docker/container network — kita jalanin app native, DB di Docker).

### 4. Nyalakan Postgres (Docker) — SUDAH JALAN
```bash
docker compose up -d postgres
```
Container `wrg-postgres`, healthy, port host 5433. Schema 38 file
`infra/postgres/init/*.sql` auto-apply saat container pertama kali dibuat.

### 5. Seed data dummy — SUDAH DIJALANKAN
Tidak ada `psql` client native di laptop ini → dijalankan via `docker exec`:
```bash
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < scripts/db/seed-dev.sql
```
Hasil: "3 AM demo (demo1/demo2/demo3), 2 plan + 1 activity (demo1), 1 todo (demo2)."
Idempoten — boleh diulang kalau perlu reset (`bash scripts/db/local-reset.sh`).

### 6. Bug Windows: `pnpm dev` gagal — SUDAH DI-FIX (belum commit)
`scripts/dev.mjs` men-spawn `turbo` tanpa `shell:true` → di Windows native
gagal `Error: spawn turbo ENOENT` (Node child_process di Windows tidak resolve
wrapper `.CMD`/`.ps1` tanpa opsi shell; Mac/Linux tidak kena bug ini karena
`turbo` di sana adalah shell script langsung executable).

Fix yang sudah diterapkan di `scripts/dev.mjs` (baris spawn turbo):
```js
const child = spawn("turbo", args, {
  stdio: "inherit",
  env: process.env,
  cwd: root,
  shell: process.platform === "win32",
});
```
**Status: masih perubahan lokal (uncommitted).** Tanyakan user apakah mau
di-commit sebagai `fix: ...` — kemungkinan besar bug ini akan dialami semua
dev Windows native lain juga.

### 7. `pnpm install` + `pnpm dev` — SUDAH JALAN
```bash
pnpm install    # ~1m40s, sukses
pnpm dev        # turbo run dev --env-mode=loose → api :4000 + web :3000
```
`pnpm-workspace.yaml` cuma cover `apps/*` + `packages/*` — **`services/ai`
TIDAK ikut ke-start oleh `pnpm dev`** (Python, bukan bagian workspace Node).

### 8. services/ai (Python) — setup & jalan terpisah
Python di laptop ini terdaftar sebagai `python` (bukan `python3`), v3.12.3.
```bash
cd services/ai
python -m venv .venv
source .venv/Scripts/activate      # Windows Git-Bash: Scripts/, bukan bin/
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Verifikasi: `curl http://localhost:8000/health` → `{"status":"ok","service":"wrg-ai"}`.

### 9. Admin user pertama — SUDAH DIBUAT
```bash
curl -X POST http://localhost:4000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@wahanalifeline.co.id","password":"rahasia123","name":"You","role":"admin"}'
```
Endpoint ini otomatis terkunci lagi setelah user pertama ada (bootstrap-only) —
tidak bisa register admin kedua lewat endpoint yang sama tanpa service token.

## Restart cepat (kalau laptop/terminal ditutup & mau lanjut kerja)

Ketiga service (api/web/ai) berjalan sebagai proses biasa (background job sesi
Claude ini) — kalau laptop restart, semuanya mati dan HARUS di-start ulang manual:

```bash
nvm use 25.6.1                  # pastikan Node yang benar aktif
docker compose up -d postgres   # kalau container postgres belum jalan
pnpm dev                        # api :4000 + web :3000 (di root repo)

# di terminal lain:
cd services/ai
source .venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```
Login web (localhost:3000) pakai: `you@wahanalifeline.co.id` / `rahasia123`.

## Reset DB kapan saja (mulai bersih)
```bash
bash scripts/db/local-reset.sh
```
(Docker: hapus volume + re-init schema + seed ulang. Lihat header script untuk opsi.)

## Gotcha yang relevan buat setup ini

- Port Postgres Docker = **5433**, bukan 5432 — kalau `DATABASE_URL` salah
  port, app tidak akan connect ke DB yang benar-benar jalan (bisa nyasar ke
  Postgres lain di 5432 kalau ada, mis. XAMPP).
- `wsl -l -v` sempat menunjukkan distro `docker-desktop` berstatus "Stopped"
  di satu titik pengecekan, tapi `docker ps` tetap sukses merespons — artinya
  engine tetap jalan (state WSL command bisa lag/berbeda momen cek). Kalau
  nanti `docker compose` gagal connect ke daemon, coba buka Docker Desktop app
  dulu secara manual sebelum debug lebih jauh.
- File onboarding (`ONBOARDING.md` dkk) & README.md yang dimodifikasi di root
  **tidak terkait** dengan setup teknis di atas — itu dokumen governance
  magang, lihat `memory.md` untuk konteksnya.

## Command cepat verifikasi ulang (kalau lanjut sesi baru)

```bash
nvm list && docker ps && pnpm --version && node --version
git status --porcelain    # cek .env, scripts/dev.mjs, README masih uncommitted?
git branch --show-current # PENTING — banyak branch fitur, cek lagi di branch mana
curl -s http://localhost:8000/health   # cek ai masih jalan
curl -s http://localhost:4000/health   # cek api masih jalan
git branch -a | grep -E "feat/f(12|22|24|26|42|50|8-|93)"   # daftar branch fitur yg ada
```
Kalau `git branch --show-current` beda dari yang mau dikerjakan → checkout
dulu, lalu WAJIB `rm -rf apps/web/.next` + restart `pnpm dev` (lihat bagian
"Ganti branch = WAJIB clear .next cache" di atas) sebelum lanjut apa pun.

## ⚠️ NOMOR MIGRASI BERUBAH SEMUA (2026-07-31) — angka di bawah ini sudah USANG

Semua penyebutan nomor migrasi di bagian-bagian LAMA di file ini (068/069/
070/071 untuk F12/F42/F93/F50) **sudah tidak berlaku**. `dev` sekarang
memakai slot 068–075, jadi lineage fitur digeser:

```
dev: 068_activity_link_visit_target, 069_pipeline_stage_7,
     069_seed_master_holiday_2026, 070_seed_cuti_bersama_2026,
     071_product_pricelist, 072_product_classification,
     073_pricebook_setup, 074_kso_simulator, 075_deal_loss_reason_opsi
     └─ SHIPPING: 076_shipment_tracking (F12)
                  077_shipment_tracking_geo (F12)
                  078_shipment_tracking_terima (F42)
                  079_shipment_tracking_bukti (F93)
     └─ OPS:      080_vehicle_operational_log (F50, standalone)
```

Apply ulang ke DB lokal (kalau container dibuat baru / `local-reset.sh`):
```bash
# migrasi dev dulu (WAJIB, kode dev sekarang butuh tabel product_*/kso_*):
for f in 068_activity_link_visit_target 069_pipeline_stage_7 \
         069_seed_master_holiday_2026 070_seed_cuti_bersama_2026 \
         071_product_pricelist 072_product_classification \
         073_pricebook_setup 074_kso_simulator 075_deal_loss_reason_opsi; do
  docker compose exec -T postgres psql -U wrg -d wrg_os -v ON_ERROR_STOP=1 \
    -f - < infra/postgres/init/$f.sql
done
# baru lineage SHIPPING (urutan PENTING, ALTER bertahap):
# 076 -> 077 -> 078 -> 079 ; F50: 080
```

**Pelajaran renumber (worth diingat, kejadian 2× sekarang):** renumber bukan
cuma `git mv` — ada 3 tempat lain yang menyebut nama file & gampang kelewat:
(1) header komentar `-- 0NN —` di baris 1 file itu sendiri, (2) referensi
LINTAS-file di dalam SQL (F42 `COMMENT ON TABLE` menyebut
`069_shipment_tracking_geo.sql`), (3) komentar di kode TS + `docs/features/*.md`
+ `scripts/db/seed-*.sql` (F50 punya 4 referensi: `index.ts`, `repo/vehicle.ts`,
docs, seed). Selalu `grep -rn "0NN_nama_file" apps/ docs/ infra/ scripts/`
sesudah rename sampai bersih.

Konflik rebase ke `dev` selalu di titik yang sama & sepele:
`apps/web/src/lib/nav.ts` baris import icon lucide — `dev` nambah
`BookOpen`/`Calculator`, fitur kita nambah `Route` (F12) / `Car` (F50).
**Gabung dua-duanya**, jangan pilih salah satu.

Cara rebase branch bertingkat setelah induknya di-rebase (hash induk berubah,
jadi `git rebase <induk>` polos bakal replay commit induk lama):
```bash
# F42 di atas F12, F12 lama tip = 46d538e:
git rebase --onto feat/f12-tracking-pengiriman-digital 46d538e feat/f42-...
# F93 di atas F42, F42 lama tip = ee71a8f:
git rebase --onto feat/f42-sj-bast-closed-loop-tracker ee71a8f feat/f93-...
```
Verifikasi tak ada yang hilang: `git diff --name-only origin/dev...HEAD`
sebelum vs sesudah harus identik KECUALI nama file migrasi.

## F45 — Pickup Pre-Visit Verification — detail operasional (2026-07-31)

Branch `feat/f45-pickup-pre-visit-verification` (standalone dari `dev`),
commit `27e29a0`, migrasi **081_pickup_plan.sql**. Desain lengkap ada di
`docs/features/F45-pickup-pre-visit-verification.md` — bagian ini cuma catatan
operasional yang tak masuk dokumen fitur.

### Cara test cron H-1 tanpa menunggu jam 16:00

```bash
# 1. Buat plan bertanggal BESOK (predikat cron = current_date + 1)
curl -s -X POST localhost:4000/pickup-plan -H 'content-type: application/json' \
  -d '{"tanggal":"<besok>","customer_name":"RS Umum Daerah Demo Sehat","account_id":900001,"tujuan":"kirim+tagih","kurir_name":"Munir","kurir_wa_number":"628...","created_by":"tes-f45"}'
# 2. Trigger manual — mengembalikan `message` tiap batch (pola runReminders),
#    jadi isi pesan WA bisa diperiksa tanpa gateway hidup:
curl -s -X POST localhost:4000/pickup-plan/previsit/run -H 'content-type: application/json' -d '{}'
# 3. Reset penanda utk mengulang test:
docker compose exec -T postgres psql -U wrg -d wrg_os -c "UPDATE pickup_plan SET previsit_notified_at=NULL WHERE created_by='tes-f45';"
# 4. Hapus data uji:
docker compose exec -T postgres psql -U wrg -d wrg_os -c "DELETE FROM pickup_plan WHERE created_by='tes-f45';"
```

⚠️ **Jebakan yang saya kena sendiri**: JANGAN taruh `POST .../previsit/run` di
dalam `until`-loop sebagai kondisi tunggu — POST-nya benar-benar jalan dan
langsung menandai semua plan ter-notifikasi, jadi run "sesungguhnya" setelah
loop balik `count: 0` dan bikin bingung. Pakai `/health` untuk menunggu.

### Emoji di respons API tak bisa dicetak ke konsol Windows

Pesan WA berisi emoji (🚚 ⚠️ 👤). `python -c "print(...)"` di Git-Bash gagal
`UnicodeEncodeError: 'charmap' codec` (konsol cp1252), dan `json.load` tanpa
`encoding='utf-8'` gagal `UnicodeDecodeError` saat membaca file respons.
Pola yang jalan: tulis ke file UTF-8 lalu baca dgn tool Read —
`json.load(io.open(path, encoding='utf-8'))` lalu `io.open(out,'w',encoding='utf-8').write(...)`.

### `.env` hanya dibaca saat proses START — tsx watch TIDAK cukup

Menambah `PREVISIT_CHECK_ENABLED=true` ke `.env` lalu menunggu tsx watch
reload **tidak berpengaruh**: env diteruskan turbo dari proses induk saat
`pnpm dev` pertama kali jalan, jadi reload tsx mewarisi env LAMA. Harus
kill process tree + `pnpm dev` ulang. Verifikasi job terdaftar:
```bash
curl -s localhost:4000/agents/schedule    # cek "enabled": true
grep -oE "\[scheduler\] aktif.*" <output-task-pnpm-dev>   # cari previsit-check=...
```
Job baru WAJIB disentuh di **3 tempat** di `scheduler.ts` (deklarasi flag,
ekspresi `status.enabled`, guard early-return `if (!enabled && ...)`) — kalau
salah satu kelewat, job diam-diam tak pernah jalan tanpa pesan error apa pun.
Sudah diverifikasi live untuk `previsit-check`.

### Temuan review F45 yang berlaku UMUM (dipakai ulang di fitur lain)

1. **`current_date` di SQL ≠ hari ini WIB.** Container Postgres ber-timezone
   `Etc/UTC`. Predikat `tanggal = current_date + 1` kebetulan benar kalau cron
   jalan 09:00–23:59 WIB, tapi SALAH kalau jalan 00:00–06:59 WIB. Selalu hitung
   tanggal di JS (`new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10)`)
   dan kirim sebagai parameter. **`repo/reminder.ts` masih punya jebakan laten
   ini** (aman di 17:00 WIB sekarang, rusak kalau jadwalnya digeser ke pagi).
2. **Nomor WA WAJIB lewat `normalizeWa()`** (`repo/master.ts`, sudah diekspor)
   sebelum disimpan ATAU dipakai sebagai kunci pengelompokan. `628…` vs
   `0812-…` vs `+62 812…` itu orang yang sama; tanpa normalisasi grup pecah.
   `master_user.wa_number` memang sudah ternormalisasi — ikuti.
3. **postgres.js gagal menyimpulkan tipe array boolean.**
   `unnest(${arr}::boolean[])` → `cannot cast type boolean to boolean[]`.
   Untuk bulk-update multi-kolom pakai `jsonb_to_recordset(${sql.json(rows)})
   AS v(id uuid, x text, y boolean)` — pola `sql.json` sudah dipakai di
   `reminder.ts`/`accurateSync.ts`.
4. **`GET /agents/schedule` TIDAK menampilkan semua job.** `status.jobs` hanya
   dibangun dari array agen A1–A12 (`scheduler.ts`); job non-Blueprint
   (reminder, previsit-check, dst) di-push ke array `live` yang cuma
   `console.log`. Jadi cara memverifikasi job baru terdaftar adalah **baris log
   `[scheduler] aktif (TZ=…): …`**, bukan endpoint itu. Endpoint hanya berguna
   untuk cek `enabled: true`.
5. **Halaman server-component yang memanggil `gatewayFetch` endpoint
   scope-aware WAJIB meneruskan `x-user-id`.** `resolveScope("")` jatuh ke
   `FULL_SCOPE` (`repo/access-scope.ts`), jadi lupa header = row-level scope
   F122 bocor tanpa error. Ambil dari `sessionUser()` (`lib/admin-guard.ts`) —
   pola di `app/api/accounts/[...path]/route.ts`.
6. **Validasi param sebelum cast `::date`/`::uuid`/`LIMIT`.** `app.onError`
   mengembalikan `err.message` mentah, jadi `?limit=abc` / `?from=xx` / id
   bukan-UUID jadi HTTP 500 + detail tipe kolom bocor. Idiom repo: `Number(x)
   || <default>` (bukan `??` — NaN lolos `??`), regex + cek round-trip untuk
   tanggal (`2026-13-45` lolos regex tapi mati di `::date`), dan guard
   `UUID_RE` sebelum query.
7. **Bedakan "sudah diproses" dari "sudah terkirim" di UI.** Kalau hasil
   verifikasi disimpan untuk semua baris tapi penanda notif hanya saat WA
   sukses, UI yang cuma melihat hasil verifikasi akan menampilkan "aman" untuk
   baris yang notifikasinya gagal/di-skip — persis kebalikan dari kenyataan.

### Temuan review F37 yang berlaku UMUM (dipakai ulang di fitur lain)

1. **Backtick di komentar SQL menutup template literal.** Di dalam
   `` sql`...` ``, komentar `-- lihat `kolom`` bikin esbuild/tsc gagal
   (`Expected ";"`). Kena 2× di sesi ini. Pakai kutip biasa di komentar SQL.
   Gejalanya membingungkan: `tsc` menunjuk baris SQL, dan `tsx watch` **tidak
   pulih** dari transform error saat startup — proses api mati dan harus
   restart manual, bukan cuma menunggu reload.
2. **`subprocess.run(..., text=True)` meng-encode stdin pakai encoding LOCALE.**
   Di Windows itu cp1252 → `UnicodeEncodeError` begitu body memuat karakter
   non-Latin1 (mis. `→`, `Σ`, atau nama SKU beraksen). Selalu tambahkan
   `encoding="utf-8"` untuk skrip yang menyuapkan SQL ke psql.
3. **`\copy FROM STDIN` = jalur eksekusi SQL dari data.** psql mendeteksi
   terminator COPY di sisi KLIEN (baris berisi tepat `\.`) dan **tidak
   menghormati quoting CSV**. Field ber-newline bisa menutup COPY lalu
   menyuapkan SQL sembarang. Tolak `\r`, `\n`, `\` di field yang jadi teks CSV
   **sebelum** membangun stream — jangan andalkan quoting.
4. **Jangan menebak locale angka.** `.replace(".","")` memperlakukan titik
   sebagai pemisah ribuan → CSV en-US (default ekspor Google Sheets) merusak
   `1.5` jadi `15` tanpa satu pun pesan. Aturan aman: kedua separator ada → yang
   terakhir = desimal; hanya `,` → desimal; hanya `.` diikuti **tepat 3 digit** →
   AMBIGU, **tolak** dan minta operator menyatakan konvensinya.
5. **`LEFT JOIN b ON … AND b.flag='x'` TIDAK menyaring baris tabel pertama.**
   Baris yang tak memenuhi syarat tetap lolos, hanya kolom `b`-nya NULL. Untuk
   membuang baris `a` berdasarkan properti `b`, taruh gerbangnya di **kondisi
   join `a`** (`AND a.kode IN (SELECT … WHERE flag='x')`) atau di WHERE.
6. **Sentinel di `accessor` DataTable ikut jadi teks pencarian.** `?? -1`
   membuat `String(-1)` = `"-1"` cocok dengan query "1" → seluruh baris lolos
   dan filter berhenti bekerja. `DataColumn` sekarang punya flag
   `searchable?: boolean` (default `true`); set `false` untuk kolom numerik
   ber-sentinel. Sentinel-nya sendiri: pakai `-Number.MAX_SAFE_INTEGER`, bukan
   `-1` (bentrok nilai negatif nyata) dan bukan `-Infinity` (komparator `av - bv`
   → `NaN` → urutan sort tak terdefinisi).
7. **Flag "kolom kosong = default aman" itu jebakan.** Kolom gerbang keamanan
   (mis. `jenis` yang memisahkan gudang cabang dari gudang customer) sebaiknya
   `NOT NULL` **tanpa default**: `DEFAULT '<yang terlihat>'` membuat insert lalai
   justru lolos, dan `DEFAULT '<yang tersembunyi>'` menyembunyikan data sah
   secara senyap. Tanpa default = penulisnya dipaksa memutuskan, dan yang lupa
   gagal keras.
8. **Bedakan "sudah diproses" dari "sudah terkirim/terlihat"** — sama seperti
   pelajaran F45. Di F37 bentuknya: `quantity` NULL dihitung sebagai anomali
   merah di ringkasan padahal barisnya tampil netral di tabel, jadi angka kartu
   tak bisa dilacak ke baris mana pun. Kartu ringkasan dan filter endpoint yang
   di-drill dari kartu itu WAJIB memakai predikat yang sama.

### Badge UI tak punya variant `success`/`warning`

`components/ui/badge.tsx` cuma punya `default|secondary|destructive|outline|
ghost|link`. Typecheck gagal kalau dipakai `success`/`warning`. Konvensi yang
ada: helper `statusTone()` yang memetakan status → salah satu variant valid
(lihat `shipments-table.tsx:34`). Utility class `text-success`/`text-warning`/
`text-danger` **memang ada** (didefinisikan di `globals.css`) — jadi untuk teks
boleh, cuma variant Badge yang terbatas.

## Status akhir sesi 2026-07-30 — sebelum restart besok, baca ini dulu

**Branch terakhir**: `feat/f93-delivery-proof-capture` (3 level di atas
`dev`: dev→F12→F42→F93). **Semua service mati saat sesi ditutup** (api/web
sempat jalan normal di branch ini; **ai/uvicorn SUDAH DIMATIKAN dari
beberapa langkah sebelumnya** krn gak dibutuhkan kerja SHIPPING/OPS —
restart manual dari nol besok kalau butuh, lihat "Restart cepat" di atas).

**Kalau besok lanjut kerja di branch F12/F42/F93 lagi** (mis. F45 kalau
udah dapat jawaban Direktur, atau iterasi lagi F93): checkout branch
paling ujung (`feat/f93-delivery-proof-capture`) sudah cukup, gak perlu
checkout satu-satu dari F12 krn F93 udah include semua commit di
atasnya. Migrasi lokal yang perlu di-apply ulang kalau DB direset
(`local-reset.sh` atau container baru): `068`→`071` di lineage ini
(`068_shipment_tracking.sql`, `069_shipment_tracking_geo.sql`,
`070_shipment_tracking_terima.sql`, `071_shipment_tracking_bukti.sql`)
— urutannya PENTING (ALTER TABLE bertahap, saling depend).

**Kalau besok mulai fitur BARU** (PURCHASING F37/F38 dst, GA F132 dst):
mulai dari `dev` (bukan dari branch F12/F42/F93), `git checkout dev &&
git pull` dulu baru bikin branch baru — jangan numpuk di branch SHIPPING
yang gak ada dependency-nya.

**Belum di-push**: `feat/f50-kendaraan-operasional-log` (commit
`b061b07`, standalone dari dev). Kalau besok mau lanjut push+PR fitur
ini, gak perlu rebase apa pun (dev belum berubah signifikan dari saat
branch ini dibuat) — tinggal `git push -u origin feat/f50-...`.

## Status keputusan README.md & dev.mjs (2026-07-28, sudah final — bukan lagi pending)

- `README.md`: user pilih **commit** versi "arsip Drive". Sudah ter-commit di
  branch `chore/readme-onboarding-drive-note`, **belum di-push/PR** (sengaja).
  **Update 2026-07-29**: sempat README working tree `dev` balik ke versi asli
  (arsitektur) — ternyata itu BUKAN versi utk anak magang, user replace manual
  jadi arsip-Drive lagi (identik dgn commit `adcc067`). Diputuskan **tetap
  uncommitted** di `dev` (sama treatment spt `scripts/dev.mjs` di bawah).
- `scripts/dev.mjs`: fix bug Windows (`shell: process.platform === "win32"`
  di spawn turbo) **sengaja dibiarkan uncommitted** di `dev` per pilihan user.

## Seed lanjutan — perbaikan 4 menu yang dilaporkan kosong/error (2026-07-28)

Semua lewat **data** di `scripts/db/seed-dev-full.sql` (append, tetap
idempoten) — **TIDAK ADA kode aplikasi (`apps/api`/`apps/web`/`services/ai`)
yang diubah** utk perbaikan ini.

### 1. HITL Review — CRASH saat dibuka (bukan cuma kosong)
Payload JSON `hitl_queue` yang di-seed awal (`{"demo":true,"deal_id":"..."}`)
tak cocok 3 bentuk yang di-expect `apps/web/(dashboard)/hitl/page.tsx`
(`report_ambiguous_match` / `pipeline_authenticity_flag` / `anomaly_flag`,
lihat `apps/api/src/repo/hitl.ts:29-35` utk shape asli). Frontend akses
`payload.item.customer` yang undefined → crash.
**Fix**: payload 2 baris lama di-`UPDATE` ke bentuk valid + 1 baris baru
`anomaly_flag`. Verifikasi: `curl "http://localhost:4000/hitl?status=pending"`
→ payload sekarang punya field `type` yang valid.

### 2. Visits — kosong
`apps/api/src/repo/visit.ts:88-131` baca dari **`sales_plan.visit_lat/
visit_lon`** (komentar eksplisit: bukan tabel `visit` legacy). Tabel `visit`
yang di-seed di awal (3 baris) **tidak pernah dibaca sama sekali**.
**Fix**: `UPDATE sales_plan SET visit_lat=..., visit_lon=...` utk 2 row
existing (Surabaya/Jakarta) + INSERT 2 row baru (demo2 Bali, demo3
Yogyakarta). Verifikasi: `curl http://localhost:4000/visits` → 4 rows,
`geo_status:"ok"`.

### 3. WatchPoint → tab "Ringkasan HoD" — status NA utk 5 dari 8 HoD
Beda dari tab "Weekly". Baca `watchpoint_metric` (metric MANUAL, bukan yang
computed live) — cuma ada 3 baris (husni: spine/orch/dash). 5 HoD lain
(mufid/arman/pakMuhid/ika/fafa) definisi metric-nya ada di
`apps/api/src/repo/watchpoint.ts:189-234` (mis. mufid: clia/fia/jv/xsell/moq).
**Fix**: INSERT 16 baris `watchpoint_metric` (angka realistis, mostly GREEN,
beberapa YELLOW) + `ON CONFLICT DO UPDATE` (bukan DO NOTHING, biar bisa re-run
dgn nilai baru kalau mau tweak).
Verifikasi: `curl http://localhost:4000/watchpoint` → mufid/arman/pakMuhid/
ika/fafa sekarang GREEN/YELLOW, bukan NA.

**Gap yang SENGAJA TIDAK di-fix (structural, bukan lupa):** metrik
`revenue`/`prod` (produktivitas) rocky & yogi tetap 0/RED. Fungsi
`revenueThisMonth()`/`productivity()` (`watchpoint.ts:86-112`) join
`accurate_invoice → accurate_salesman.master_user_id (BIGINT) →
master_user.am_id (TEXT)`. AM demo pakai am_id teks `demo1/demo2/demo3` —
**tidak bisa** dicocokkan ke kolom BIGINT tanpa restrukturisasi identitas AM
demo di SEMUA tabel lain (deal/sales_plan/dst sudah terlanjur pakai 'demo1'
sbg teks di mana-mana). Kalau mau benerin ini di masa depan: opsi paling
aman adalah bikin AM demo BARU dgn am_id numerik khusus utk keperluan
Accurate-mirror-linkage, bukan retrofit demo1/2/3 yang sudah dipakai luas.
Metrik `visits` rocky sendiri SUDAH live & non-zero (4) setelah
`hod_territory` ditambah mapping `('rocky','Demo')` — karena
`visitsThisMonth()` join langsung `sales_plan.am_id = master_user.am_id`
(tak lewat accurate_salesman, jadi tak kena masalah tipe data yang sama).

### 4. NPK Direktur — kosong
`apps/web/(dashboard)/npk/page.tsx:41` default period = semester berjalan
(`S2` utk bulan≥7 — sekarang Juli 2026). Data cuma ada `period='S1'`
(rocky/yogi doang, dari seed awal).
**Fix**: INSERT header (`npk_score_semester`) + detail 7 aspek
(`npk_aspect_score`) utk 6 HoD lain (mufid/arman/pakMuhid/ika/fafa/husni) ×
S1+S2, plus S2 utk rocky/yogi. Pola: raw=capped=X sama utk semua 7 aspek per
HoD (krn bobot 25/15/10/15/15/10/10 jumlah=100, jadi npk=X persis, gampang
konsisten). Verifikasi WAJIB pakai header `x-user-id` (app_user id admin),
BUKAN curl polos ke `:4000/npk/scores` — tanpa header itu scope resolve ke
kosong (`scope:"self"`, `rows:[]`) meski data ada, krn `visibleHods()`
default-safe kalau tak ada identitas (lihat `apps/api/src/repo/access-scope.ts`
`FULL_SCOPE` + `apps/api/src/repo/npk.ts:221-225`). Contoh test yang benar:
```bash
curl "http://localhost:4000/npk/scores?year=2026&period=S2" \
  -H "x-user-id: 583fb44f-9313-438c-a19f-29e6518c5bd5"   # id admin dari /auth/register
```

⚠️ **Catatan jujur soal data NPK ini**: beda dari live compute (`npk.ts`
komentar "KEJUJURAN DATA" — aspek kso/gp/crm/coaching SELALU stub krn
sumbernya belum ada di sistem sama sekali; revenue/customer/ar SELALU stub
utk HoD non-cabang), baris yang di-seed di atas SEMUA `available:true` dgn
angka dummy murni demi tampilan. Kalau endpoint `POST /npk/compute` beneran
dipanggil, data ini akan **ditimpa balik** ke mayoritas stub/0 sesuai
batasan sistem yang sebenarnya saat ini — jangan kaget kalau itu terjadi,
itu bukan bug, itu compute asli menang atas seed dummy.

### Pelajaran metodologi (penting kalau debug menu "kosong" lagi di masa depan)
1. Cek dulu apakah UI benar-benar baca dari tabel yang kamu kira — kadang ada
   tabel dgn nama mirip yang TIDAK dipakai (kasus `visit` vs `sales_plan`).
2. Endpoint yang scope-aware (butuh `x-user-id`, mis. NPK, sales-analytics)
   HARUS ditest lewat header itu / lewat web BFF (:3000/api/...) dgn cookie
   session — curl polos ke API :4000 kasih hasil BEDA (scope kosong) dan bisa
   nyasar ke kesimpulan "datanya belum ada" padahal datanya ADA, cuma scope
   test-nya yang salah.
3. Cek filter tanggal/periode default di kode UI/backend — data seed harus
   match periode yang di-default-kan (kasus S1 vs S2 NPK).

## Fitur F22/F24/F26/F8 (AFTERSALES) — detail teknis (2026-07-29)

Ringkasan arsitektur tiap fitur ada di `docs/features/F22-*.md` /
`F24-*.md` / `F26-*.md` / `F8-*.md` (sudah ter-commit di git, per-branch).
Bagian ini cuma catatan OPERASIONAL yang tak masuk dokumentasi fitur itu sendiri.

### Branch & git — lihat `memory.md` bagian "F22/F24/F26/F8" untuk diagram
lengkap. Ringkas: F22 (`feat/f22-instalasi-alat-lifecycle`) → F24 di
atasnya (`feat/f24-pm-kalibrasi-schedule`) → **F8 di atas F24**
(`feat/f8-teknisi-readiness-board`, 4 level dari `dev`). F26 berdiri sendiri
dari `dev` (`feat/f26-service-ticket-triage`), tak nyambung ke 3 lainnya.

### Migrasi baru per fitur (nomor lanjut PER-LINEAGE, ada 2 file "070" beda lineage!)
- `068_installation_lifecycle.sql` — F22, tabel `installation_unit`.
- `069_maintenance_schedule.sql` — F24, tabel `maintenance_schedule` (FK ke `installation_unit`).
- `070_service_ticket_triage.sql` — F26 (lineage `dev` langsung), tabel `teknisi_roster` + `service_ticket` (self-contained).
- `070_teknisi_readiness_board.sql` — F8 (lineage F22→F24), tabel `teknisi_capacity`/`install_schedule`/`maintenance_schedule`(baca)/`teknisi_report`. **Sama nomor `070` dgn file F26 di atas TAPI beda lineage branch** — bukan git-conflict, tapi WAJIB direnumber (`071`) oleh siapa pun yg merge branch KEDUA ke `dev`.

Apply ke DB dummy lokal (tak ada `psql` native, selalu via docker exec — SEMUA
4 migrasi + seed SUDAH diterapkan ke container `wrg-postgres` yang sama,
walau beda lineage branch, krn DB dev cuma satu instance dipakai bergantian):
```bash
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < infra/postgres/init/068_installation_lifecycle.sql
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < infra/postgres/init/069_maintenance_schedule.sql
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < infra/postgres/init/070_service_ticket_triage.sql
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < infra/postgres/init/070_teknisi_readiness_board.sql
# seed teknisi_roster (F26, Andi/Budi/Citra/Dedi/Eka) + teknisi_capacity (F8, Fajar/Gilang/Hesti):
docker compose exec -T postgres psql -U wrg -d wrg_os -f - < scripts/db/seed-dev-full.sql
```
Kalau container di-hapus/`local-reset.sh` dijalankan, ke-4 file di atas harus
di-apply ulang manual (belum di-merge ke `dev`, jadi tidak akan otomatis
ke-apply oleh siapa pun lain sampai PR-nya merge). **`scripts/db/seed-dev-full.sql`
juga untracked di lineage F22/F24/F8** (cuma ter-commit di branch F26) — kalau
pindah ke branch F22/F24/F8 dan file itu hilang dari disk, restore dgn:
```bash
git show feat/f26-service-ticket-triage:scripts/db/seed-dev-full.sql > scripts/db/seed-dev-full.sql
```

### F8 — WA hashtag pipeline TERVERIFIKASI LIVE (beda dari F26)
F8 extend `#install/#servis/#training/#kalibrasi` ke pipeline `#plan/#report`
Teknisi yang SUDAH ADA (grup sama, `WA_INBOUND_GROUPS` existing) — bukan hook
baru spt F26. Karena `WA_INBOUND_GROUPS` kosong lokal (allow-all), bisa test
via endpoint manual-trigger yang SUDAH ADA (`POST /wa/inbound/process`,
`index.ts:2986`):
```bash
# 1. set sementara di .env: WA_INBOUND_PROCESS=true, lalu restart pnpm dev
# 2. insert simulasi pesan masuk
docker compose exec -T postgres psql -U wrg -d wrg_os -c "
INSERT INTO wa_message (group_jid, sender_jid, sender_name, message_type, body, message_id, received_at)
VALUES ('test@g.us', 'x@s.whatsapp.net', 'Teknisi Fajar', 'text', '#install alat X terpasang lancar', 'test-1', now());"
# 3. trigger
curl -sX POST localhost:4000/wa/inbound/process -H 'content-type: application/json' -d '{}'
# → kind:"install", teknisi ter-match, teknisi_report tercipta, balasan stub terkirim
# 4. KEMBALIKAN .env WA_INBOUND_PROCESS=false lagi + restart pnpm dev (jangan lupa!)
```
Idempotensi (re-run tak reprocess pesan yg sudah `processed_at`) & unknown-sender
silent-skip (nama tak match `teknisi_capacity` → `skipped:"unknown-sender"`,
tanpa reply) sudah dikonfirmasi jalan.

### Ganti branch = WAJIB clear `.next` cache Next.js
Next.js App Router nyimpen daftar route (`.next/types/validator.ts`) yang
beda per branch (tiap fitur nambah halaman/route beda). Kalau `git checkout`
ke branch lain sementara `pnpm dev` masih jalan / baru mau `tsc --noEmit`,
sering muncul error salah `Cannot find module '.../page.js'` nyariin route
yg cuma ada di branch SEBELUMNYA. **Fix wajib tiap ganti branch:**
```bash
rm -rf apps/web/.next
# lalu restart pnpm dev — cari & kill process tree lama dulu (tsx watch + next dev
# tetap pegang file walau branch sudah pindah, restart biasa tak cukup):
wmic process where "name='node.exe'" get ProcessId,CommandLine | grep -i "pnpm.mjs dev"
taskkill //PID <pid_pnpm_dev> //T //F
pnpm dev
```
Kalau cuma `rm -rf .next` tanpa restart proses, dev server yg masih jalan
bakal 500 (Turbopack nyari file yang baru dihapus). Services/ai (uvicorn
`--reload`) juga kadang race kalau BANYAK file Python berubah bersamaan
dalam <1 detik (reload ke-trigger sebelum semua file ke-save) — kalau
endpoint baru balik `404 Not Found` padahal kode sudah benar, restart
manual uvicorn (jangan cuma andalkan `--reload`).

### Alur PR — pengalaman nyata sesi ini (F22, PR #679 / Issue #680)
1. `git push -u origin feat/f22-instalasi-alat-lifecycle` → GitHub kasih
   link langsung `.../pull/new/<branch>`.
2. Buka link itu → base=`dev`, judul `feat(F22): ...`, body isi section
   "⚠️ BUTUH MIGRASI DB" (ONBOARDING.md wajib) → jadi PR #679.
3. Item board Roadmap "F22 Instalasi Alat Lifecycle" awalnya **status
   "Draft"** (bukan Issue asli — cek badge di panel detail waktu diklik).
   Klik **"Convert to issue"** di panel → jadi Issue #680.
4. Edit deskripsi PR #679, tambah baris `Closes #680` → GitHub otomatis
   link 2 arah, kolom "Linked pull requests" di board Roadmap ikut keisi.
5. `gh` CLI **tidak ada** di laptop ini (`where gh` kosong) — semua manual
   lewat web UI GitHub, TIDAK bisa `gh pr create`.
6. F24 (dibangun di atas F22) sengaja BELUM di-push — tunggu PR #679
   di-**merge** (bukan cuma approve) dulu, baru `git rebase` F24 ke `dev`
   terbaru sebelum push+PR, biar diff-nya bersih (tak kebawa gabung F22).

### Code review manual F26 (belum ada grup WA utk test live) — 2 bug ketemu & fix
Lihat `docs/features/F26-service-ticket-triage.md` bagian "Auto-assign &
needs_review" utk detail lengkap. Ringkas: (1) area matching dulu exact
case-sensitive tanpa fallback → ticket bisa unassigned total kalau area
LLM beda kapitalisasi/tak match; (2) severity invalid dari LLM di-default
diam-diam ke "sedang" tanpa flag. Keduanya sudah fix (commit `749cacf` di
branch F26) — case-insensitive match + fallback least-loaded + field baru
`severity_uncertain`.

### Verifikasi tanpa API key OpenRouter (semua endpoint LLM lokal)
`services/ai` semua endpoint LLM (`/triage-ticket`, `/detect-leave`, dst)
otomatis fallback ke `dry-run`/`sedang`/default aman kalau `OPENROUTER_API_KEY`
tak di-set di `.env` lokal — ini BUKAN error, itu mode dev yang disengaja.
Untuk test path LLM yang beneran classify (severity berubah-ubah sesuai isi
komplain), butuh API key asli — tidak dilakukan sesi ini.

Cara simulasi panggil fungsi TS langsung (bypass HTTP, dipakai berkali-kali
sesi ini utk test cron/idempotensi tanpa nunggu scheduler/webhook asli):
```bash
# tulis script kecil di apps/api/ (BUKAN /tmp — resolusi import relatif butuh cwd yg benar)
cat > apps/api/test-tmp.mjs <<'EOF'
import { someFn } from "./src/repo/somefile.js";
console.log(await someFn(...));
EOF
export $(grep -E '^DATABASE_URL=' .env)   # dari root repo, BUKAN dari dalam apps/api
(cd apps/api && npx tsx test-tmp.mjs)     # subshell () — cwd utama TIDAK ikut pindah
rm -f apps/api/test-tmp.mjs               # hapus dari root repo, path relatif dari root
```
**Gotcha yang kejadian beberapa kali sesi ini:** `cd apps/api && npx tsx ...`
TANPA subshell `()` bikin cwd Bash-tool nyangkut di `apps/api` utk command
SEQUENTIAL berikutnya (`rm -f apps/api/...` jadi salah path, `ls` false-negative).
Selalu bungkus `cd` sementara dengan `(...)` subshell kalau tak mau cwd utama
ikut pindah.

## Ganti branch pakai TaskStop — TIDAK cukup, selalu kill process tree manual

`TaskStop` pada task `pnpm dev` di sesi ini SELALU cuma matiin wrapper
shell-nya, bukan process tree node (pnpm→turbo→tsx/next) di baliknya — proses
node tetap hidup & port tetap kepakai. **Wajib tiap mau ganti branch atau
restart bersih:**
```bash
wmic process where "name='node.exe'" get ProcessId,CommandLine | grep -i "turbo\|next\|tsx\|pnpm"
# lalu taskkill //PID <tiap pid ketemu> //T //F  (banyak "not found" itu normal,
# artinya sudah kena kill duluan lewat parent tree-nya)
```
Baru setelah itu `rm -rf apps/web/.next` + `pnpm dev` lagi. Sama berlaku utk
`services/ai` (uvicorn) — kadang crash sendiri kalau proses node yang di-kill
kebetulan share dependency start-up; cek `curl :8000/health` abis ganti
branch, restart manual kalau perlu (`cd services/ai && source
.venv/Scripts/activate && uvicorn app.main:app --reload --port 8000`).

## Rebase branch fitur lokal (dgn 2 file uncommitted README.md/dev.mjs)

Pola aman dipakai berkali-kali sesi ini buat rebase (mis. F24 ke F22 terbaru):
```bash
git stash push -m "local: readme arsip-drive + dev.mjs windows fix" -- README.md scripts/dev.mjs
git checkout <branch-tujuan>          # atau git rebase <branch-lain> langsung kalau udah di branch yg mau di-rebase
git rebase <branch-sumber-terbaru>
git stash pop
rm -rf apps/web/.next && pnpm dev     # restart (ingat kill process tree dulu, lihat di atas)
```
Push update ke PR yang sudah ada (bukan bikin PR baru): PR nempel ke NAMA
branch, jadi `git push --force-with-lease origin <branch>` otomatis update PR
lama. Perlu `--force` krn rebase ubah hash commit sendiri.

## F12 — Tracking Pengiriman Digital (SHIPPING) — detail teknis (2026-07-30)

Branch `feat/f12-tracking-pengiriman-digital`, dari `dev` (bukan dari branch
F22/F24 manapun — SHIPPING domain berdiri sendiri). Commit `2983f85`, belum
push. Ringkasan desain ada di `docs/features/F12-tracking-pengiriman-digital.md`
(termasuk keputusan rapat soal TTF diabaikan + formula ETA). Catatan
operasional yang tak masuk dokumentasi fitur:

### Bug ketemu & di-fix saat testing: postgres.js parse date/timestamptz jadi objek Date
`mapRow()` di repo baru sempat pakai `String(r.eta_date)` polos → hasil API
`"Wed Aug 05 2026 07:00:00 GMT+0700 (Indochina Time)"` (verbose), bukan ISO
`"2026-08-05"`. Sebab: `postgres` npm package (dipakai `db.ts`) otomatis
parse kolom `date`/`timestamptz` jadi `Date` object di JS, dan `String(dateObj)`
manggil `.toString()` verbose itu — BUKAN `.toISOString()`. **Kemungkinan besar
bug laten yang sama juga ada di file repo LAIN yang pola `String(r.kolom_tanggal)`**
(mis. `apps/api/src/repo/maintenance.ts` due_date/reference_date, F24) —
belum diverifikasi/di-fix di sesi ini krn di luar scope F12, tapi worth
dicek kalau ada laporan tanggal aneh di UI manapun. Fix yang dipakai di F12
(`shipment-tracking.ts`):
```ts
const toIsoDate = (x: unknown): string => new Date(x as string | Date).toISOString().slice(0, 10);
const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
```
Aman dipanggil baik `x` sudah `Date` object maupun masih string dari driver.

### Testing WA hashtag #KIRIM/#BAST — pola sama F8, env WA_INBOUND_PROCESS
```bash
# 1. set sementara .env: WA_INBOUND_PROCESS=true, restart pnpm dev (kill process tree dulu!)
# 2. buat shipment dulu via API (perlu sj_number match persis WA hashtag)
curl -X POST localhost:4000/shipment-tracking -H 'content-type: application/json' \
  -d '{"sj_number":"SJ-TEST-002","customer_name":"RS Kupang","cabang":"Surabaya","distance_km":300}'
# 3. insert simulasi WA masuk
docker compose exec -T postgres psql -U wrg -d wrg_os -c "
INSERT INTO wa_message (group_jid, sender_jid, sender_name, message_type, body, message_id, received_at)
VALUES ('test@g.us', 'kurir@s.whatsapp.net', 'Kurir Budi', 'text', '#KIRIM SJ-TEST-002', 'test-kirim-1', now());"
curl -sX POST localhost:4000/wa/inbound/process -H 'content-type: application/json' -d '{}'
# → kind:"kirim", shipment_id ter-match, kirim_by="Kurir Budi", balasan stub terkirim
# 4. ulangi utk #BAST (SJ sama) → status jadi "bast"
# 5. test SJ tak ditemukan: "#KIRIM SJ-TIDAK-ADA" → error:"sj-not-found", balasan error (bukan silent)
# 6. HAPUS data uji + KEMBALIKAN .env WA_INBOUND_PROCESS=false + restart pnpm dev
```
Beda dari F8: sender TIDAK di-gate (tak ada roster kurir/master data), jadi
SIAPAPUN yang kirim `#KIRIM [SJ valid]` di grup allowed bakal ke-proses —
sengaja (kurir off-limits dari `master_user`, sama filosofi `teknisi_name`
bebas teks di F22).

### ⚠️ OPEN ITEM: `distance_km` harus otomatis, bukan manual (koreksi 2026-07-30)

Implementasi awal F12 (commit `2983f85`) bikin `distance_km` sbg field input
manual di form `/shipment-tracking` — user koreksi ini SALAH baca transkrip
rapat. Yang benar: km dihitung otomatis dari koordinat titik A (cabang) ke
titik B (customer) — semacam haversine/straight-line distance, BUKAN diketik
Admin Shipping. Commit follow-up `eab9b11` cuma nambah dokumentasi ⚠️ +
hint UI, **BELUM** ubah kode logic (`computeEta`/`createShipment` tetap
terima `distance_km` sbg parameter, dipanggil manual dari form spt semula).

Blocker implementasi: 2 sumber data koordinat belum ada di sistem & user
pilih tanya Direktur/Biz Dev dulu drpd ditebak:
1. **Titik A (cabang/gudang asal)** — opsi: (a) tabel referensi baru
   `cabang → lat/lon`, diisi manual SEKALI oleh admin per cabang (jumlah
   cabang sedikit, jarang berubah — beda dgn "manual per shipment" yang
   ditolak user), atau (b) cek dulu apakah `accurate_branch` (mirror
   Accurate) sudah simpan lat/lon — kalau ada, reuse langsung tanpa tabel baru.
2. **Titik B (lokasi customer)** — opsi: (a) reuse `sales_plan.visit_lat/
   visit_lon` (sudah ada dari fitur Visits/AM geo-tagging, TAPI cuma nutup
   customer yg PERNAH dikunjungi AM — gap nyata utk customer baru/tak pernah
   dikunjungi), atau (b) input SEKALI per customer (map picker) saat
   tracking pertama dibuat utk customer itu, tersimpan reusable utk shipment
   berikutnya.

**Kalau sesi depan lanjut F12 ini:** JANGAN langsung implementasi salah satu
opsi di atas — cek dulu ke user apakah sudah ada jawaban dari
Direktur/Biz Dev. Kalau belum, opsi manual `distance_km` yang jalan sekarang
tetap dipakai (functional, cuma bukan UX final).

**Update investigasi 2026-07-30 (dua Explore agent, hasil faktual):**

*Titik A (cabang)*: dicek `accurate_branch` (`infra/postgres/init/013_crm_accurate_mirror.sql`)
— kolom cuma `id BIGINT, name TEXT, suspended BOOLEAN, raw JSONB,
last_synced_at`. TIDAK ADA lat/lon. Grep seluruh `apps/api/src` + `apps/web/src`
utk branch+lat/lon/koordinat/gudang → nihil. **Kesimpulan: klaim user
"koordinat cabang sudah ada datanya" bukan berarti sudah ada DI SISTEM —
kemungkinan besar cuma ada di luar sistem (Excel Admin Shipping), perlu
tabel referensi baru + input manual SEKALI per cabang.**

*Titik B (customer) dari WA*: `wa_message` punya kolom geo
(`geo_lat NUMERIC(9,6), geo_lon NUMERIC(9,6), geo_ts TEXT, geo_address TEXT`
— migrasi `025_wa_message_geo.sql`). Diisi HANYA oleh proses OCR
`check_photo_geotag.py` yang jalan di **wa-bridge (host, di luar apps/api)**
utk pesan **image** (lihat komentar migrasi + `apps/api/src/repo/wa.ts`
fungsi `ingestWaMessages`/`mapOpenclaw` — `message_type` di-derive dari MIME,
BUKAN dari event "share location" WA). Ada 1 baris dead-code di
`apps/api/src/repo/monitor.ts:157` (`if (t === "location") return {type:
"location", …}`) tapi `message_type` itu TAK PERNAH benar2 di-set oleh
ingestion — jadi WA "share live location" native **TIDAK didukung**, cuma
foto ber-geotag (Geo-Tagging Camera app, sama yg dipakai AM utk visit) yang
bisa. `inbound.ts` `photoFollowup()` yang sudah ada (baca `row.geo_lat/lon`)
HARD-WIRED ke domain AM (`sales_plan`/`activity_log`) — TIDAK bisa dipanggil
langsung utk F12, perlu logic baru kalau mau reuse pola yg sama.

**Gap desain yg masih kebuka**: kapan foto ber-geotag customer itu diambil —
pas `#KIRIM` (blm nyampe, gak ada lokasi customer) atau `#BAST` (nyampe,
tapi ETA jadi telat/useless krn dihitung SETELAH kejadian selesai)? Hipotesis
paling masuk akal: capture+simpan PERMANEN per customer di shipment PERTAMA
(dari foto BAST), shipment KEDUA dst ke customer sama baru dapat ETA di awal
pakai koordinat tersimpan. User pilih tanya Direktur/Diana dulu (2026-07-30
malam) — JANGAN infer sendiri jawabannya sesi depan, tanya dulu apa sudah
ada kabar.

## F42 — SJ-BAST Closed-Loop (SHIPPING) — detail teknis (2026-07-30)

Branch `feat/f42-sj-bast-closed-loop-tracker`, DI ATAS `feat/f12-tracking-pengiriman-digital`
(bukan dari `dev` — F42 extend tabel `shipment_tracking` milik F12). Commit
`887efec`, belum push. Detail desain lengkap di
`docs/features/F42-sj-bast-closed-loop-tracker.md`.

### Guard `markBast()` diubah — precondition sekarang `terima`, bukan `dikirim`
```ts
// SEBELUM (F12 doang): if (rows[0].status !== "dikirim") reject
// SESUDAH (F42): if (rows[0].status !== "terima") reject
```
Ini BREAKING utk siapa pun yang test #BAST via WA tanpa tandai `terima`
dulu — sengaja (business rule baru), balasan WA-nya tetap ramah (pesan
error jelas, generic error-handling di `inbound.ts` sudah otomatis pakai
`action.error`, tak perlu ubah kode inbound sama sekali).

### Migrasi ALTER (bukan CREATE) — 069 di lineage F12
`069_shipment_tracking_terima.sql` — `ALTER TABLE` (drop+recreate CHECK
constraint via `DROP CONSTRAINT IF EXISTS` lalu `ADD CONSTRAINT`, standar
Postgres krn tak ada `ALTER CONSTRAINT` utk ganti definisi CHECK) + 2 kolom
baru (`terima_at`, `terima_by`). Beda dari F12/F50 yg CREATE TABLE baru —
ini yang pertama kali di sesi ini nunjukin pola "F24-style" extend tabel
punya fitur sebelumnya dalam SATU lineage branch (F22→F24 dulu juga gini,
tapi beda tabel; F42→F12 ini SAMA tabel `shipment_tracking`, ganti dari
CREATE ke ALTER).

### Test guard via curl — urutan salah HARUS ditolak semua
```bash
# draft -> bast langsung: DITOLAK ("langkah terima belum ditandai")
# draft -> kirim -> bast (skip terima): DITOLAK juga
# draft -> kirim -> terima -> bast: SUKSES semua
```
Dites juga lewat WA hashtag simulasi (`#KIRIM` sukses → `#BAST` prematur →
balasan error → `POST /shipment-tracking/:id/terima` via API → `#BAST`
ulang → sukses) — pola testing sama spt F12 (env `WA_INBOUND_PROCESS=true`
sementara, restart, test, revert, restart lagi).

## F12 — geo-capture otomatis (jawaban final Direktur) — detail teknis (2026-07-30)

Diimplementasikan di branch `feat/f12-tracking-pengiriman-digital` sendiri
(commit `7832d92`), lalu F42 di-`git rebase` di atasnya (commit `035393d`
hasil rebase + `7f2585a` fix renumber migrasi). Detail desain lengkap:
`docs/features/F12-tracking-pengiriman-digital.md` poin 2 (Keputusan
Desain).

### Migrasi 069 (F12) vs 070 (F42) — konflik nomor akibat rebase, cara resolve
Sebelum rebase: F12 punya 068, F42 (branch di atas F12) punya 069
(`069_shipment_tracking_terima.sql`). Waktu nambah fitur geo LANGSUNG ke
branch F12 (bukan F42), F12 otomatis "mengklaim" nomor 069 baru
(`069_shipment_tracking_geo.sql`) krn itu next-in-sequence di branch F12
sendiri. Begitu F42 di-rebase ke F12 yang sudah update, migrasi F42 yang
tadinya `069_...terima.sql` HARUS di-`git mv` jadi `070_...terima.sql`
(sekaligus edit komentar header nomor di dalam filenya) — kalau tidak,
ada 2 file "069" beda isi dlm SATU lineage yang sama (beda dari kasus
F26/F8 duplikat 070 yg emang beda lineage & diterima).

### Rebase conflict di `shipment-tracking.ts` — 2 titik, keduanya di `markBast`
1. Header komentar file (F12 punya versi geo, F42 punya versi
   terima-guard) — digabung manual jadi 1 komentar yang cover keduanya.
2. Guard `if (rows[0].status !== ...)` — F12 (base lama) blm ada guard
   `terima`, versi HEAD abis geo-edit masih `!== "dikirim"`; F42 mau
   `!== "terima"`. Resolve: pakai guard F42 (`terima`) DITAMBAH logic
   hitung geo dari F12 (bukan pilih salah satu, gabung keduanya — guard
   duluan, baru hitung `distanceKm`/`etaDays` dari `kirim_lat/lon` yg
   sudah ada + `opts.lat/lon` BAST yang baru masuk).

### Bug 2 lapis — lupa update route HTTP setelah update repo function
`markKirim`/`markBast` di `shipment-tracking.ts` diupdate terima
`{lat, lon}`, TAPI route `POST /shipment-tracking/:id/kirim`/`/bast` di
`index.ts` lupa diupdate buat extract `lat`/`lon` dari request body & pass
ke fungsi repo — ketauan pas test end-to-end (`kirim_lat` tetap `null`
walau curl kirim `{"lat":...,"lon":...}`). **Pelajaran**: kalau nambah
parameter baru ke fungsi repo yg dipanggil dari route, WAJIB grep semua
caller (route handler, web proxy kalau ada) — jangan asumsikan cuma edit
1 file sudah cukup krn TypeScript gak akan error (parameter opsional,
compile tetap lolos, cuma runtime silently jadi `undefined`).

### Test haversine — jarak Surabaya↔Malang
`haversineKm(-7.2575, 112.7521, -7.9666, 112.6326)` → **79.9 km** (jarak
lurus/great-circle; jarak jalan sungguhan lebih, ~87km, tapi utk analitik
kesesuaian ballpark ini cukup — sengaja bukan routing API).

## F93 — Delivery Proof Capture (OPS) — detail teknis (2026-07-30)

Branch `feat/f93-delivery-proof-capture`, DI ATAS `feat/f42-...` (yang DI
ATAS F12) — commit `a56cc79`, belum push. Detail desain:
`docs/features/F93-delivery-proof-capture.md`.

### Desain slot-foto (bukan array, 2 kolom terpisah + fallback logic)
`markBukti()` pakai SQL `CASE WHEN ${slot} = 'bukti_photo_path' THEN
${photoPath} ELSE bukti_photo_path END` (dan sama utk signature) — `slot`
ditentukan di JS SEBELUM query (`!rows[0].bukti_photo_path ?
'bukti_photo_path' : !rows[0].signature_photo_path ? 'signature_photo_path'
: null`), bukan logic SQL murni. Alternatif yang lebih "SQL-native" (pakai
array kolom `photo_paths text[]` dgn `array_append`) SENGAJA tidak dipakai
— 2 kolom terpisah lebih mudah query/tampilkan di UI (kolom "Bukti (F93)"
di tabel butuh tau spesifik mana yg sudah/belum, bukan cuma "ada N foto").

### Guard status `bast` — F93 gak nambah state, cuma nempel field
Beda dari F42 (nambah state `terima`), F93 TIDAK mengubah state machine —
`markBukti()` return `{ok:true, status:"bast"}` (status gak berubah).
Row-actions web (`shipment-tracking-row-actions.tsx`) jadi butuh logic
KHUSUS (bukan pola `STEP_BY_STATUS[row.status]` yang generik 1-step-per-
status) krn "tandai bukti" itu AKSI TAMBAHAN yang nempel di status
TERMINAL (`bast`), bukan transisi ke status baru:
```ts
const buktiLengkap = !!row.bukti_photo_path && !!row.signature_photo_path;
const step = row.status === "bast" ? (buktiLengkap ? null : buktiStep) : STEP_BY_STATUS[row.status];
```

### Kontradiksi deskripsi board (sama pola F42/F45) — kali ini user gak minta tanya Direktur lagi
Beda dari F42 (2 pertanyaan → tanya Direktur) dan F45 (F14 gak ketemu →
tanya Direktur), F93 punya kontradiksi serupa (`#KIRIM` di teks vs
`#BUKTI` di field Hashtag vs "audit BAST" di konteks) tapi user pilih
LANGSUNG terima rekomendasi Claude (`#BUKTI` di momen BAST) tanpa iterasi
tanya-jawab lagi. Kemungkinan krn user sudah cukup pede baca pola
kontradiksi board setelah 2x kejadian sebelumnya. **Kalau nanti Direktur
klarifikasi sebaliknya (mis. ternyata beneran `#KIRIM`), tinggal ubah 1
baris guard di `markBukti()` (`status !== "bast"` → `status !== "draft"`
atau apa pun sesuai jawaban baru) + pindah posisi handling di
`inbound.ts` — desainnya cukup terisolasi, gak nyebar ke banyak file.**

## F50 — Kendaraan Operasional Log (OPS) — detail teknis (2026-07-30)

Branch `feat/f50-kendaraan-operasional-log`, dari `dev` (standalone, tak
nyambung F12/F42/F45). Commit `b061b07`, belum push. Detail desain di
`docs/features/F50-kendaraan-operasional-log.md`. Catatan operasional:

### Lint gotcha: `react-hooks/set-state-in-effect`
Pola awal `HistoryDialog` (dialog riwayat log kendaraan) manggil
`setLoading(true)` LANGSUNG di body `useEffect` sebelum `fetch` — ESLint
error `Avoid calling setState() directly within an effect`. Fix: buang state
`loading` terpisah, pakai `useState<T[] | null>(null)` (null = belum
fetch/loading), `setState` HANYA dipanggil di dalam `.then()` callback (bukan
sinkron di body effect). Render check `logs === null` langsung (bukan
variabel `loading` terpisah) — kalau pakai variabel terpisah, TypeScript tak
bisa narrow `logs` jadi non-null di branch selanjutnya (`logs.length` error
possibly-null). Pola ini WORTH diingat kalau bikin dialog serupa lagi
(fetch-on-open + tampilkan loading state).

### Migrasi 068 dipakai 3× oleh 3 lineage berbeda (F22/F12/F50)
Sekarang ada F22 (`068_installation_lifecycle.sql`), F12
(`068_shipment_tracking.sql`), DAN F50 (`068_vehicle_operational_log.sql`)
sama-sama nomor 068 tapi beda file/tabel/lineage — konsisten sama pola
"per-lineage duplicate number" yang sudah diterima sejak F26/F8 (lihat
bagian atas). Ketiganya sudah diterapkan ke DB dev lokal yang SAMA (satu
instance dipakai bergantian) tanpa konflik krn nama tabel beda-beda
(`installation_unit`/`shipment_tracking`/`vehicle`+`vehicle_log`). **Siapa
pun yang merge salah satu duluan ke `dev`, migrasi lain WAJIB direnumber**
(069/070/dst) sebelum PR-nya sendiri di-merge — cek dulu docs/MIGRATIONS.md.

### Reuse endpoint `/accurate/shipments` yang sudah ada di `dev`
Endpoint backend `GET /accurate/shipments` (mirror delivery-order Accurate)
SUDAH ADA di `dev` sebelum F12 (dipakai menu Shipments biasa). F12 cuma
nambah proxy BFF `apps/web/src/app/api/shipments/route.ts` (belum ada di
`dev`, baru ada di branch F22 sebelumnya) supaya form "Tambah tracking" bisa
pilih No. SJ dari situ — persis pola picker SJ yang dipakai F22
`installation-row-actions.tsx`.

## F37 — Cross-Branch Stock Visibility (PURCHASING) — detail teknis (2026-07-31)

Branch `feat/f37-cross-branch-stock-visibility`, dari `dev` langsung
(standalone). Migrasi `082_cross_branch_stock.sql`. Push + PR dibuka
(base=dev). Detail desain lengkap: memori auto-save
`wrg-os-f37-cross-branch-stock`.

### Gerbang gudang virtual customer — `jenis` NOT NULL TANPA default
Tabel `warehouse` punya kolom `jenis text NOT NULL CHECK (jenis IN
('cabang','customer'))` **tanpa DEFAULT** — sengaja, supaya INSERT yang
lalai menyebut `jenis` GAGAL KERAS (NOT NULL violation) daripada
diam-diam masuk sebagai NULL dan lolos dari filter `WHERE jenis='cabang'`
di query baca. Semua query baca gerbangnya ada di kondisi JOIN
(`JOIN warehouse w ON w.kode = sb.warehouse_kode AND w.jenis = 'cabang'`),
bukan LEFT JOIN + filter terpisah — LEFT JOIN tanpa filter di ON tidak
menyaring apa pun, baris tetap tampil dengan `w.*` NULL.

### 11 gudang cabang final (koreksi 2× dari Direktur)
Direktur awalnya cuma sebut 5 gudang di board, lalu koreksi via chat:
**Surabaya, Lamongan, Tuban, Jember, Kediri, Madiun, Madura, Jakarta,
Jogja&Solo, NTB, NTT** — plus tegas bilang gudang virtual di customer
JANGAN ditampilkan. Koreksi kedua: "Surabaya 1" itu maksudnya **jumlah**
("di Surabaya ada 1 gudang"), bukan penomoran urut — jadi kode gudangnya
`SBY` polos, bukan `SBY1`. Kode draft lama (`PUSAT`, `KEMANGI`, `SBY1`)
di-`UPDATE aktif=false`, BUKAN di-DELETE (FK `item_stock_branch` pakai
`ON DELETE CASCADE`, DELETE bisa nyapu stok yang sudah keburu terisi).

### Importer — abort di dalam transaksi (fix 2026-07-31, sesi lanjutan)
Versi awal cek "0 SKU cocok" di Python **SETELAH** `subprocess.run` psql
selesai (body `BEGIN...COMMIT` sudah tereksekusi penuh) — kalau CSV kolom
`sku` salah format total DAN dipakai bareng `--hapus-tak-disebut`, DELETE
sudah ter-COMMIT sebelum Python sempat abort. Diperbaiki (pola sama F38):
pindah ke `DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM stg s
JOIN accurate_item ai ON ai.no = s.sku; IF n = 0 THEN RAISE EXCEPTION
'...'; END IF; END $$;` DI DALAM SQL body, sebelum blok INSERT/DELETE.
Ditambah guard baru: `--hapus-tak-disebut` DITOLAK kalau ada sel qty
kosong (sel kosong = "belum diisi", bukan "sudah nol" — kalau lolos,
DELETE bisa menyapu kombinasi (sku,gudang) yang sebenarnya cuma belum
di-opname ulang). Diverifikasi empiris via `docker exec wrg-postgres psql`
lokal: CSV isi SKU salah semua + `--apply --hapus-tak-disebut` → exit 1,
jumlah baris `item_stock_branch` SEBELUM = SESUDAH (7 baris, tak berubah).
Commit `f68fc06`, push biasa (bukan amend/force — nambah commit baru di
atas history yang sudah ada, aman untuk PR yang sudah terbuka).

### Cara test importer tanpa `psql` native di Windows
```bash
export PSQL_BIN="docker exec -i wrg-postgres psql -U wrg"
python scripts/db/import_stock_branch.py --file <csv> --db wrg_os [--apply] [--hapus-tak-disebut]
```
(nama container: `docker ps` → `wrg-postgres`, bukan lewat `docker compose`
krn tidak jalan dari compose file di sesi ini).

## F38 — ED Watch & Near-Expiry Alert (PURCHASING) — detail teknis (2026-07-31)

Branch `feat/f38-ed-watch-near-expiry`, **DI ATAS `feat/f37-...`** (butuh
tabel `warehouse` migrasi 082). Migrasi `083_stock_batch_ed.sql`. Push +
PR dibuka (base=`feat/f37-...`, BUKAN dev — pola sama F22→F24→F8). Detail
desain penuh: `docs/features/F38-ed-watch-near-expiry.md` + memori
auto-save `wrg-os-f38-ed-watch` (termasuk daftar lengkap 10+ temuan review
adversarial & cara verifikasi empirisnya).

### Kenapa tabel baru, bukan extend `item_stock_branch` (F37)
PK F37 adalah `(item_id, warehouse_kode)`. ED itu milik BATCH, bukan item
— satu SKU bisa punya beberapa batch ber-ED beda di gudang yang sama.
Menambah kolom batch ke F37 berarti mengubah PK tabel yang sudah di-PR.
Jadi `item_stock_batch` PK `(item_id, warehouse_kode, batch_no)`, berdiri
sendiri, dikorelasikan ke F37 (bukan diturunkan/di-`SUM` paksa — cakupan
keduanya beda, sparepart tanpa ED tetap punya opname agregat F37).

### Penanda ambang pakai ANGKA (`alert_tier_terkirim`), bukan 3 boolean
Alert cuma bunyi kalau tier SEKARANG lebih kecil dari yang tercatat. Kalau
pakai boolean per-ambang (90/60/30 masing-masing kolom), cron yang mati
seminggu lalu nyala lagi pas batch sudah lompat dari 65→58 hari akan
KEHILANGAN ambang 60 (boolean-nya belum pernah di-set true, tapi baris
data sudah "lewat" ambang itu tanpa tercatat). Kolom angka `< tercatat`
menangkap lompatan itu otomatis.

### Tier 0 (sudah lewat ED) — WAJIB, bukan kosmetik
`tierUntuk(sisaHari)`: `if (sisaHari < 0) return 0;` harus jadi cabang
PALING AWAL. Tanpa tier 0, siklus alert normal 90→60→30 BERHENTI bunyi
tepat saat paling mendesak (`30 < 30` = false begitu sisa hari negatif) —
padahal itu titik saran berubah jadi `retur`, satu-satunya saran yang
butuh tindakan segera.

### Gateway WA — penanda cuma boleh dibakar kalau BENAR-BENAR terkirim
`sendViaWaGateway` (`apps/api/src/wasend.ts`) balikin `sent:true` juga di
mode **stub** (`WA_SEND_URL` kosong) dan **dry-run** (`WA_DRY_RUN`, DEFAULT
`"true"`). Syarat nulis penanda: `gateway.sent && !gateway.stub &&
!gateway.dryRun`. Diverifikasi 2 arah pakai gateway HTTP tiruan lokal
(`python -m http.server` custom, port 9911): mode stub → `notified: 0,
skipped: "stub-tidak-menandai"`; mode live (`WA_DRY_RUN=false` + gateway
tiruan) → `notified: 3`, penanda benar-benar tertulis. **Bug yang sama
ditemukan juga di F45 (`runPreVisitCheck`, BELUM diperbaiki, PR sudah
dibuka — jadi utang tercatat) dan F50 (`runVehicleAlerts`, SUDAH
diperbaiki commit lokal `e098dd3`).**

### Dua definisi ambang yang SENGAJA beda — jangan disatukan
Kolom "Sisa" di tabel detail pakai definisi KUMULATIF (`sisa<=30` termasuk
yang sudah lewat) karena itu yang memicu alert di `runEdWatch`. Kartu
ringkasan pakai ember SALING LEPAS (`lewat`/`0-30`/`31-60`/`61-90`/`>90`/
`tanpa ED`) supaya bisa dijumlahkan pembaca. Versi awal filter tombol
tier di `listStockBatch` ikut pakai kumulatif → klik kartu "≤30 hari"
(1 baris) balikin 2 baris karena definisi beda. Fix: filter tombol diubah
eksklusif biar cocok sama kartu, predikat `runEdWatch` TETAP kumulatif
(sengaja, dikomentari eksplisit alasannya biar tidak ke-refactor lagi
tanpa sadar).

### KSO dari histori faktur, bukan kolom manual
`accurate_invoice_item.raw->>'charField1'` bernilai `KSO`/`REGULAR`/
`RUTIN`/`PL`/`ECAT` — data produksi nyata, dipakai juga view Per-Pengadaan
(`sales-analytics.ts`). Dibaca dari `accurate_invoice_item` (punya kolom
`item_id` sendiri) BUKAN dengan membongkar array
`accurate_invoice.raw->'detailItem'` — objeknya sama, tapi jauh lebih
murah utk cron harian (index `item_id` vs unnest array tiap baris invoice).
Ini PETUNJUK bukan kontrak (tak ada registri KSO aktif per customer di
sistem) — ED pendek tetap MENGALAHKAN saran KSO.

### Rebase F38 ke F37 setelah F37 dapat fix importer
F38 awalnya dibuat di atas F37 commit `bfc6515` (sebelum fix importer
`f68fc06` ada). Setelah F37 di-push ulang dengan fix itu, F38 di-`git
rebase origin/feat/f37-cross-branch-stock-visibility` — **0 konflik**
(F38 tidak menyentuh `import_stock_branch.py` sama sekali), langsung
`Successfully rebased`. Push F38 sesudahnya adalah push PERTAMA branch
itu (`git push -u origin ...`), jadi tidak butuh force sama sekali.

### Cara verifikasi wiring scheduler tanpa restart manual berulang
`ED_WATCH_ENABLED=true` di `.env` → cek log startup `tsx watch` memuat
`ed-watch=30 7 * * *`, DAN `/agents/schedule` (endpoint admin) melaporkan
`enabled: true`. **Endpoint itu TIDAK menampilkan `ed-watch` di daftar
`jobs`** — field itu cuma memuat agen A1-A12, bukan semua cron granular.
Verifikasi env ini WAJIB dikembalikan (`ED_WATCH_ENABLED` off lagi) setelah
selesai cek, supaya tidak ada job nyala tak sengaja di dev berikutnya.

## SESI 2026-08-03 — domain grouping (9 branch via worktree), F37 route split, F50 rebase, F52 baru

### Kenapa Docker Desktop kadang perlu di-start manual
Awal sesi ini `docker ps` gagal (`cannot connect to ... dockerDesktopLinuxEngine`)
— aplikasi Docker Desktop belum jalan (bukan cuma daemon di-stop). Fix:
```bash
powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"
timeout 90 bash -c 'until docker ps >/dev/null 2>&1; do sleep 3; done'
```
Baru setelah itu `docker compose up -d postgres` bisa jalan.

### Pola git worktree utk edit banyak branch tanpa ganggu dev server aktif
Dipakai 9× sesi ini (domain-grouping tiap branch fitur). Working tree UTAMA
tetap di branch yang lagi dites user (`pnpm dev` jalan di situ), branch LAIN
diedit di worktree sementara:
```bash
mkdir -p "<scratchpad>/wt-f22"
git worktree add "<scratchpad>/wt-f22" feat/f22-instalasi-alat-lifecycle
cd "<scratchpad>/wt-f22" && <edit file, commit, push>
cd <root> && git worktree remove "<scratchpad>/wt-f22" --force
```
**Constraint**: git tidak izinkan branch yang sama checkout di 2 worktree
sekaligus — kalau branch itu sedang aktif di working tree utama, worktree
utk branch itu harus dibuat SETELAH working tree utama pindah ke branch lain
(atau tunggu giliran).

Untuk branch BERTINGKAT (F24 di atas F22, F42/F93 di atas F12, F38 di atas
F37) — setelah root-nya diedit+push, rebase child SETELAH root: `git
worktree add <path> <child-branch> && cd <path> && git rebase <root-branch>
&& git push --force-with-lease`. Semua rebase F42→F12 dan F93→F42 di sesi
ini **0 konflik** (child tak pernah sentuh `nav.ts` sendiri, cuma warisan
dari root) — cuma F24→F22 yang konflik (F24 py baris sendiri di `nav.ts`
persis di titik yg dipindah root).

### Migrasi 084 — F52, slot bebas berikutnya
Per sesi ini, nomor migrasi tertinggi di SEMUA branch aktif (bukan cuma
`dev`): F38=083. Jadi F52 (branch baru dari `dev` fresh) ambil **084**. Cara
cek cepat semua branch sekaligus:
```bash
for b in feat/f37-... feat/f38-... feat/f45-... feat/f50-... feat/f12-... \
         feat/f42-... feat/f93-... feat/f22-... feat/f24-... feat/f26-...; do
  git ls-tree -r origin/$b --name-only -- infra/postgres/init | sort | tail -1
done
```

### F37 Stok Gudang: page.tsx + component pattern utk split dari tab
Pola yang dipakai (reusable kalau ada tab lain yg perlu di-split jadi route
mandiri): server component page.tsx fetch data via `gatewayFetch` langsung
(bukan lewat proxy `/api/*` yg dulunya cuma dipakai client-side lazy-fetch),
lempar sbg `initial` prop ke client component yang HANYA menangani interaksi
filter (client masih fetch ulang ke `/api/stock/*` pas filter ganti, krn itu
genuinely butuh interaktivitas). Data awal SEKARANG server-rendered (bukan
lagi lazy on-tab-open) krn alasan "jangan bebani pemakai tab lain" sudah
tidak berlaku setelah jadi route sendiri.

`EdWatchPanel` (F38) BEDA — sudah 100% self-contained (fetch semua data di
`useEffect` saat mount, tanpa props) sejak awal, jadi split-nya jauh lebih
simpel: cuma pindah komponennya apa adanya ke page.tsx baru, tanpa refactor.
**Pelajaran: cek dulu apakah komponen tab itu sudah self-contained atau
butuh data dari parent sebelum decide pendekatan split-nya.**

### Split gudang Jogja/Solo — hapus vs deactivate
```sql
-- Migrasi 082 diedit LANGSUNG (blm merge ke manapun, aman diedit in-place):
-- ganti baris INSERT JOGJASOLO jadi 2 baris JOGJA + SOLO (urutan 90, 91).
-- DB lokal yang sudah kadung py baris JOGJASOLO (dari apply migrasi versi
-- lama) di-DELETE langsung (bukan aktif=false) krn 0 baris item_stock_branch
-- mereferensikannya:
DELETE FROM warehouse WHERE kode='JOGJASOLO';
```
Kalau kode itu SUDAH pernah dipakai import data nyata di environment manapun
(termasuk dev orang lain), harus `aktif=false` spt pola `PUSAT`/`KEMANGI`/
`SBY1`, bukan DELETE (FK `item_stock_branch.warehouse_kode` bisa cascade).

### F50: rebase 42 commit ketinggalan → 0 konflik
```bash
git checkout dev && git pull --ff-only origin dev   # atau fetch+rebase origin/dev langsung
git checkout feat/f50-kendaraan-operasional-log
git rebase origin/dev
```
Bersih total — diff `feat/f50...dev` SEBELUM rebase penuh noise (file dev yg
lebih baru muncul sbg "dihapus" krn F50 belum py itu), SESUDAH rebase diff
jadi murni 14 file milik F50 sendiri. **Ini pola yang benar utk mengecek
"apa fitur ini masih bersih vs dev" — `git diff --stat origin/dev <branch>`,
bukan asumsi dari kapan branch dibuat.**

Kolom "BBM Bulan Ini" (`repo/vehicle.ts`): agregat dgn LEFT JOIN subquery,
BUKAN N+1 per-row query:
```sql
SELECT v.*, COALESCE(b.liter,0) bbm_liter_bulan_ini, COALESCE(b.cost,0) bbm_cost_bulan_ini
FROM vehicle v
LEFT JOIN (SELECT vehicle_id, SUM(bbm_liter) liter, SUM(bbm_cost) cost
           FROM vehicle_log WHERE log_type='bbm' AND log_date >= ${wibMonthStart}::date
           GROUP BY vehicle_id) b ON b.vehicle_id = v.id
```
`wibMonthStart()` dihitung di JS (`Date.now()+7h, slice(0,7)+"-01"`) — bukan
`date_trunc('month', current_date)` SQL, krn container UTC (pelajaran
berulang F38/F45).

### F52 — businessHoursFromNow(), cara kerja & cara verifikasi
```ts
// Trik: geser cur +7h ke "ruang WIB", lakukan SEMUA operasi kalender
// (Y/M/D, endOfDay) di ruang itu, tapi HANYA pakai hasilnya sbg DURASI
// (selisih 2 titik di ruang yang sama) — bukan absolut. `cur` asli (real
// ms, unshifted) yang selalu diakumulasi pakai durasi itu. Ini valid krn
// selisih 2 nilai yg digeser konstanta sama = selisih nilai aslinya juga.
```
Diverifikasi via script sekali-pakai (bypass HTTP, panggil fungsi langsung):
```bash
cat > apps/api/test-sla-tmp.mjs <<'EOF'
import { businessHoursFromNow } from "./src/repo/it-ticket.js";
const fri = Date.UTC(2026,7,7,16,0,0); // Jumat 23:00 WIB
console.log((await businessHoursFromNow(fri, 2)).toISOString());
EOF
export $(grep -E '^DATABASE_URL=' .env)
timeout 20 bash -c '(cd apps/api && npx tsx test-sla-tmp.mjs)'
rm -f apps/api/test-sla-tmp.mjs
```
⚠️ Script yg import `db()` TIDAK exit sendiri (connection pool postgres.js
tetap terbuka) — selalu bungkus `timeout Ns` dan `process.exit(0)` di akhir
script kalau ada logic setelah query, kalau tidak proses nge-hang sampai
timeout tercapai (bukan gagal, cuma buang waktu).

### F52 — CRUD aset vs seed: kapan pilih yang mana
Beda dari F50 (`vehicle`, 7 baris, seed SQL) — `it_asset` dikasih CRUD web
krn populasinya lebih besar & lebih sering berubah (PC/laptop kantor, bukan
armada kendaraan tetap). Aturan praktis: **seed SQL kalau count() kecil &
JARANG berubah (tahunan), CRUD kalau count() bisa besar ATAU sering
berubah (bulanan/mingguan)** — bukan cuma soal "kecil vs besar".

### F52 — gabung 2 halaman jadi 1 (tab), pola reusable
```
apps/web/src/components/crm/it-asset-view.tsx   -- client, state tab
apps/web/src/app/(dashboard)/it-asset/page.tsx  -- server, fetch KEDUA data
                                                    sekaligus (assets+tickets
                                                    kecil, ga masalah beban)
```
`nav.ts` cukup 1 entry (`/it-asset`), 1 RBAC key. Beda dari kasus F37/F38
(split KELUAR dari halaman existing beda-domain) — F52 gabung 2 KONSEP
DALAM 1 fitur baru yg sama, jadi tab di 1 halaman itu valid & bukan
kontradiksi sama prinsip domain-grouping.

### Reminder ketat: `rm -rf .next` WAJIB sambil dev server MATI
Kejadian lagi sesi ini — habis edit banyak file lalu buru-buru mau
typecheck, lupa proses `pnpm dev` masih hidup pas `rm -rf apps/web/.next`.
Next dev (Turbopack) langsung 500 nyariin manifest yang baru dihapus. Urutan
WAJIB: **kill process tree dulu → `rm -rf .next` → `pnpm dev` lagi**, jangan
pernah rm sambil proses hidup walau "cuma mau typecheck sebentar".

## F53 — cara bongkar file "bundler artifact" (single-file HTML export)

Repo `github.com/DevWRG/label-asset` isinya cuma 1 file `index.html` (581KB,
180 baris — baris SANGAT panjang). Ciri "bundler artifact" (mirip export
dari tool Artifact): ada elemen `#__bundler_loading`/`#__bundler_thumbnail`
+ script tag `type="__bundler/manifest"` / `"__bundler/ext_resources"` /
`"__bundler/template"`. Isi asli (HTML/CSS/JS readable) ada di dalam
`__bundler/template`, tapi bentuknya JSON STRING TER-ESCAPE (`/` dkk),
jadi `grep` string biasa gagal total. Cara bongkar:
```bash
node -e "
const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf-8');
const m = content.match(/<script type=\"__bundler\/template\"[^>]*>([\s\S]*?)<\/script>/);
const tmpl = JSON.parse(m[1]);           // <- kunci: ini JSON string, bukan HTML mentah
fs.writeFileSync('template-extracted.html', tmpl);
"
```
Hasilnya HTML/CSS/JS biasa yang bisa dibaca `Read`/`grep` normal. Manifest
lain (`__bundler/manifest`) isinya asset biner (gambar) base64-encoded per
UUID key — tak perlu dibongkar kecuali butuh asetnya.

## F53 — pola cetak: window.open + document.write (BUKAN CSS print in-app)

Next.js app punya layout dashboard permanen (sidebar dll) — kalau print
langsung dari halaman yang sedang dibuka, perlu CSS `@media print` rumit
utk sembunyikan seluruh chrome. Pola yang SUDAH ADA & lebih simpel
(`sales-analytics-dashboard.tsx`):
```ts
const w = window.open("", "_blank");
if (!w) { /* popup diblokir, kasih pesan */ return; }
w.document.write(fullHtmlString); // halaman BARU, tanpa app chrome sama sekali
w.document.close();
```
`fullHtmlString` bikin sendiri dari nol (bukan reuse layout React apa pun),
termasuk tombol print sendiri (`<button onclick="window.print()">`)
+ `@media print { .toolbar{display:none} }` supaya tombolnya tak ikut
tercetak. QR/gambar taruh sbg `data:` URI inline (base64) supaya halaman
baru itu genuinely standalone, tak perlu fetch apa pun.

## Bug pola tabel riwayat (`<th>`/`<td>` padding) — ditemukan F53, ada juga di F50

`<th className="pb-2">`/`<td className="py-1.5">` TANPA padding horizontal
sama sekali → kolom nempel, dan sel yang isinya wrap (tanggal panjang,
"Tidak ditemukan") kepotong/tabrakan visual dgn kolom sebelah. Screenshot
user nunjukin ini jelas. **Fix**: tambah `pr-4` di semua kolom kecuali yang
terakhir + `whitespace-nowrap` di kolom pendek (tanggal/status/angka) +
`overflow-x-auto` di container pembungkus (jaga-jaga kalau tetap kepotong
di dialog sempit). Ketemu di 2 tempat (F53 `asset-tag-row-actions.tsx` dan
F50 `vehicle-row-actions.tsx` — yang kedua ini SUMBER pola yang di-copy),
keduanya diperbaiki. **Kalau nemu komponen baru pakai pola tabel serupa
(`<table>` polos + `py-*` doang, tanpa `px-*`/`pr-*`), cek dulu apa itu
copy dari file lain — kemungkinan besar sumbernya py bug yang sama.**
