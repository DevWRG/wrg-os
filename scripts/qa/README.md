# QA — simulasi command hashtag WA

Menjalankan tiap command hashtag WA terhadap DB nyata dan membandingkan teks
balasannya dengan yang diharapkan. 41 skenario: 15 command + varian argumen
kosong, format salah, kode tak ketemu, galat state machine, dan 5 uji
penembusan gerbang pengirim.

**Tidak pernah mengirim WA.** `WA_SEND_URL` dikosongkan (mode STUB) dan
`WA_DRY_RUN=true`.

## Kenapa ini ada

Command hashtag itu mahal diverifikasi manual: butuh baris `wa_message` dengan
pengirim yang benar, roster yang cocok, dan data transaksi pada tahap yang
tepat. Akibatnya gampang "diverifikasi" hanya dengan membaca string balasan di
kode — dan cacat yang cuma muncul saat dieksekusi lolos. Empat cacat nyata
ditemukan begitu 15 command ini benar-benar dijalankan (lihat PR fix
`inbound-hashtag-ketahanan`), termasuk `#KLAIM` yang menghilangkan klaim secara
permanen saat `services/ai` mati.

Teks balasan **tidak ada di return value** — `WaSendResult` sengaja hanya
membawa `{to, sent, stub}` dan pesan keluar tak disimpan ke DB. Satu-satunya
sumbernya adalah stdout `wasend.ts` mode STUB/DRY-RUN. Harness membajak
`console.log` dan memungut blok `--- pesan --- … --- selesai ---`.

## Jalankan (DB dev yang sudah ada)

```bash
# 1. skema mutakhir
bash scripts/db/migrate.sh                       # --dry-run dulu utk lihat yg pending

# 2. data — URUTAN WAJIB. seed-dev-full BERGANTUNG pada seed-dev:
#    crm_account punya FK owner_am_id -> master_user, dan master_user demo1-3
#    berasal dari seed-dev.sql. Dibalik/dilewati => "violates foreign key
#    constraint crm_account_owner_fk ... Key (owner_am_id)=(demo1)".
psql -d wrg_os_dev -f scripts/db/seed-dev.sql
psql -d wrg_os_dev -f scripts/db/seed-dev-full.sql
psql -d wrg_os_dev -f scripts/qa/seed-hashtag-fixtures.sql

# 3. harness memuat apps/api/dist, jadi build dulu
pnpm --filter @wrg/api build

# 4. jalan
node scripts/qa/sim-hashtag.mjs                  # semua
node scripts/qa/sim-hashtag.mjs stok sph         # filter nama skenario
```

## Setup dari NOL (anak magang / mesin baru)

Diuji betulan di DB kosong: hasil akhir **42/42**. Tiga hal yang bikin tersandung
kalau langkah di atas dituruti mentah-mentah:

**1. `migrate.sh` tidak bisa bootstrap DB kosong.** `001_extensions.sql` memuat
`CREATE DATABASE langfuse`, dan `migrate.sh` menjalankan tiap berkas dalam satu
transaksi (`psql -1`) — `CREATE DATABASE` haram di dalam transaksi, jadi migrasi
mati di berkas pertama:

```
psql:001_extensions.sql:8: ERROR: CREATE DATABASE cannot run inside a transaction block
```

Jalur resmi untuk mesin baru adalah **Docker** (`docs/LOCAL-DEV.md` /
`scripts/db/local-reset.sh`) — Postgres meng-apply `init/*.sql` lewat
`docker-entrypoint-initdb.d`, di luar transaksi, jadi 001 lolos.

Kalau pakai Postgres native, pasang extension-nya manual lalu tandai 001 sudah
apply, baru lanjut:

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
```

`vector` = pgvector, extension pihak ketiga (`brew install pgvector`); tanpa itu
migrasi yang memakainya gagal. `CREATE DATABASE langfuse` yang dilewati tak
dipakai harness ini.

Kabar baiknya: di DB **benar-benar baru**, **155 migrasi apply bersih tanpa satu
pun error** — termasuk rantai view KSO `098`–`126` yang justru gagal di DB dev
lama (lihat "Batasan" di bawah).

**2. `seed-dev-full.sql` WAJIB, dan tetap tak cukup.** Ia mengisi
`accurate_item`, `teknisi_capacity`, dll — tapi **tidak** `product_pricelist`,
karena data price book nyata tak boleh masuk repo publik (F142). Tanpa fixture
price book, `#SPH` gagal 2 skenario. `seed-hashtag-fixtures.sql` menambal itu
dengan 3 SKU **rekaan** (nama diawali `QA `, angka bulat asal — bukan harga
sungguhan), jadi harness tak lagi bergantung pada katalog nyata.

Harness memeriksa prasyarat ini di awal dan berhenti dengan pesan jelas — supaya
gagal DATA tak menyamar jadi gagal KODE:

```
Prasyarat DATA belum lengkap — bukan kegagalan kode:
  · product_pricelist: SKU ber-diskon_maks ≥ 5% — dibutuhkan #SPH
```

**3. `tsconfig.tsbuildinfo` basi bikin build "sukses" tanpa meng-emit.** Kalau
`apps/api/dist` pernah dihapus manual, `tsc` bisa melihat buildinfo lama,
menyimpulkan semuanya mutakhir, lalu **keluar rc=0 tanpa menulis apa pun** —
lalu harness bilang `Cannot find module .../dist/db.js` padahal build "berhasil".

```bash
rm -f apps/api/tsconfig.tsbuildinfo && pnpm --filter @wrg/api build
```

`DATABASE_URL` default `postgres:///wrg_os_dev`. Exit code 1 kalau ada skenario
tak cocok, jadi bisa dipakai sebagai gerbang manual.

## Brief untuk tim magang

`BRIEF-UJI-MAGANG.md` — hand-out siap kirim: aturan data (kenapa dump prod tidak
dipakai), setup dari nol, generator volume sintetis, cara menjalankan aplikasi,
dan daftar apa yang harus diuji di **jalur tulis** (satu-satunya celah yang tak
tertutup harness mana pun di folder ini).

`seed-volume-sintetis.sql` — ~46.000 baris BUATAN di tabel mirror Accurate supaya
menu berat (Stock Gudang, ED Watch, Sales Overview, Customers, Orders, Shipments,
Price Book) terasa realistis tanpa menyalin sebaris pun data produksi.
Deterministik (tanpa `random()`), idempoten, semua id di ruang 900.000.000+ dan
nama diawali `SINTETIS`.

## BACA vs TULIS — baca ini sebelum jalan di luar dev

Tiap skenario ditandai, dan tandanya muncul di keluaran:

```
✓ [COCOK] BACA  stok · argumen kosong        ← #STOK
✓ [COCOK] TULIS approve · tahap terakhir     ← #APPROVE APR-9001 oke lanjutkan
```

**27 BACA** — tak mengubah data domain. **14 TULIS** — jalur suksesnya punya
efek nyata:

| Command | Efek kalau sukses |
|---|---|
| `#APPROVE` `#REJECT` | **benar-benar memutuskan** approval request |
| `#KIRIM` `#BAST` `#BUKTI` | memajukan status SJ di `shipment_tracking` |
| `#HELPDESK` | membuat tiket GA bernomor urut |
| `#SPH` | menyimpan draft SPH atas nama AM |
| `#KLAIM` | menyimpan baris `doc_klaim` |
| `#install` `#servis` `#training` `#kalibrasi` | menyimpan `teknisi_report` |

Terhadap fixture (dev) itu aman — semua sasarannya milik fixture sendiri
(`QA-AM-1`, `SJ-QA-00x`, `APR-900x`). Terhadap **data nyata, menjalankannya
bukan verifikasi melainkan transaksi**: approval orang betulan ikut diputus dan
nomor tiket betulan ikut terpakai.

Karena itu ada dua pengaman:

- **`--baca-saja`** hanya menjalankan 27 skenario BACA, dan **mencetak daftar 14
  yang dilewati** — supaya "semua hijau" tak terbaca sebagai verifikasi penuh.
- **Skenario TULIS ditolak kalau fixture tak ada.** Fixture absen = DB ini bukan
  DB fixture, jadi harness berhenti dengan instruksi, bukan menulis ke data
  orang. Exit code 1.

### Kalau mau pakai data real (mis. sesudah promote ke main)

Command BACA justru lebih bermakna diuji terhadap katalog & roster nyata. Satu
hal yang harus di-override: nomor WA fixture tak ada di roster nyata, jadi
gerbang `resolveSender` menolaknya dan semua command baca cuma membalas hening —
itu terbaca seperti kerusakan padahal cuma identitas pengirimnya tak dikenal.

```bash
QA_AM_WA=6281234567890 QA_AM_NAMA="Nama AM Asli" \
  node scripts/qa/sim-hashtag.mjs --baca-saja
```

Env yang tersedia: `QA_AM_WA`/`QA_AM_NAMA`, `QA_HOD_WA`/`QA_HOD_NAMA`,
`QA_TEKNISI_WA`/`QA_TEKNISI_NAMA`, `QA_GRUP_JID`, `QA_AI_STUB_PORT`. Nama
dipakai mencocokkan balasan yang menyebut nama, jadi harus persis seperti di
`master_user`/`app_user`. Pengirim `ASING` **sengaja tak bisa di-override** — ia
harus tetap tak dikenal roster mana pun, itu inti 5 uji penembusan gerbang.

### "Baca-saja" bukan berarti nol tulis

Harness **selalu** menyisipkan baris `wa_message` — `processInboundMessage`
butuh baris nyata untuk diproses. Baris itu ber-`input_hash` prefiks `qa-sim-`.
Di DB nyata, baris sintetis itu ikut terbaca rekap/digest WA kalau dibiarkan:

```sql
DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%';
```

Perintah itu juga dicetak di akhir tiap run.

**Bisa dijalankan berulang.** `resetState()` mengembalikan SJ dan approval
request ke tahap awal tiap kali mulai. Tanpa itu, run ke-2 gagal palsu (SJ sudah
terkirim, APR sudah disetujui) dan terbaca seperti regresi.

## Smoke permukaan baca API — `smoke-api-read.mjs`

Alat kedua, beda sasaran. `sim-hashtag.mjs` menguji **balasan** command WA;
yang ini menguji **seluruh permukaan baca HTTP** apps/api terhadap DB nyata.

```bash
pnpm --filter @wrg/api build
node scripts/qa/smoke-api-read.mjs
DATABASE_URL=postgres:///wrg_os_dev node scripts/qa/smoke-api-read.mjs
```

Skrip mem-boot `apps/api/dist/index.js` sendiri (port `SMOKE_PORT`, default
4199), memukul tiap route, lalu mematikannya. **Hanya GET — tak ada tulis**, dan
scheduler dimatikan (`AGENT_SCHEDULE_ENABLED=false`) + WA dry-run, jadi tak ada
cron atau kirim WA yang ikut jalan. Aman untuk DB berisi data.

Daftar route **diekstrak dari `apps/api/src/index.ts`**, bukan dihardcode —
fitur baru otomatis ikut teruji tanpa menyentuh skrip ini.

Yang dicari: handler yang meledak karena SQL-nya menyebut kolom/tabel yang tak
ada, join salah, atau enum tak cocok. Kelas kegagalan itu lolos dari
lint/typecheck/CI, dan cuma muncul kalau query-nya benar-benar dieksekusi.

### Non-2xx yang benar didaftar eksplisit

`HARAPAN_NON_2XX` (dan `HARAPAN_NON_2XX_DETAIL` untuk route `:id`) memetakan
route → status yang diharapkan, dengan alasannya sebagai komentar. Sengaja
per-route, bukan "abaikan semua 4xx": begitu ada route **baru** yang balas
non-2xx, ia tak ada di daftar → langsung jadi temuan, bukan tenggelam.

Yang terdaftar sekarang: 6 route butuh query param wajib (400), 3 butuh
identitas user bukan service-token (401), 2 ditolak scope (403), `/health/mirror`
melaporkan mirror basi (503 — itu jawaban benar di dev), dan 3 route detail
(item SO/SJ ditarik on-demand dari API Accurate → 503 tanpa kredensial; satu
butuh param `period`).

### Baseline di `wrg_os_dev`

```
route tanpa param : 181  → 2xx=169  non-2xx-sesuai-harapan=12
route :id         :  53  → 2xx=8    tak-teruji=42
GAGAL             : 0
```

**42 endpoint detail tak teruji** karena tabelnya kosong — dicetak satu-satu di
akhir laporan, bukan disembunyikan. Untuk 33 menu batch magang, tabel kosong itu
kondisi wajar hari-1 di prod juga, jadi hijau di sini memang bermakna. Tapi
join di endpoint detail itu tetap belum pernah dieksekusi.

Yang **tidak** tercakup alat ini, dan perlu diuji terpisah:

- **Jalur tulis (POST/PATCH/DELETE)** — di situ error FK/constraint muncul
  begitu orang memasukkan data. Paling cocok diuji lewat UI oleh yang tahu alur
  bisnisnya.
- **Volume data prod.** 6 berkas repo baru membaca mirror Accurate yang besar
  (`cek.ts`, `inbound-cek.ts`, `forecast.ts`, `stock-batch.ts`,
  `stock-branch.ts`, `sph.ts`). `wrg_os_dev` punya 12 `accurate_item` dan 40
  SO/DO; prod ~5.800 dan ~11.800/11.900. Jalankan ulang skrip ini di salinan
  dump prod untuk menutup celah itu.

## Tidak dipasang di CI

Butuh Postgres ber-skema penuh + katalog `accurate_item`/`product_pricelist`,
jadi tak cocok untuk runner CI. Invarian yang **bisa** diuji tanpa DB sudah
dipisah ke tes murni yang ikut CI:

- `apps/api/src/repo/inbound-reply.test.ts` — balasan `#REPORT` AM
- `apps/api/src/repo/inbound-kind-filter.test.ts` — paritas daftar hashtag
  (`INBOUND_HASHTAGS` ↔ `detectKind` ↔ regex penyaring `processUnprocessed`).
  Ini yang menjaga kelas bug `#BUKTI`: hashtag dikenali detektor tapi hilang
  dari penyaring query, jadi pesannya dibaca benar lalu dibuang diam-diam.

## Fixture

Semua identitas berdiri sendiri supaya tak menyentuh baris nyata: `master_user`
`QA-AM-1`, `app_user` `hod@qa.invalid`, teknisi `Joko Fixture`, SJ `SJ-QA-00x`,
approval `APR-900x`, price book `QA-PL-00x` (`row_no` 900001+ agar tak bentrok
`UNIQUE (periode, row_no)` dengan hasil import nyata). Nomor WA `62811100000x` —
bukan nomor yang bisa dihubungi.

Empat gerbang pengirim yang diuji, masing-masing sumbernya **beda**:

| Command | Gerbang | Sumber |
|---|---|---|
| `#STOK` `#CEK` `#PRICING` `#SPH` | `resolveSender` | `master_user.wa_number` |
| `#install` `#servis` `#training` `#kalibrasi` | `matchTeknisiByName` | `teknisi_capacity.nama` (pushname) |
| `#APPROVE` `#REJECT` | `resolveApprover` | `app_user.wa_number` + `hod_key` |
| `#KLAIM` `#KIRIM` `#BAST` `#BUKTI` `#HELPDESK` | — sengaja terbuka | — |

`services/ai` distub di dalam harness (port `QA_AI_STUB_PORT`, default 8099)
supaya `#KLAIM` bisa diuji tanpa `.venv` FastAPI maupun kunci OpenRouter. Satu
skenario sengaja mengarahkan `AI_URL` ke port mati untuk memastikan
`services/ai` yang tak terjangkau dibalas sopan, bukan merobohkan batch.

## Catatan alur shipping

Rantai lapangan yang benar **bukan** `#KIRIM → #BAST`:

```
#KIRIM  →  (admin tandai TERIMA di web)  →  #BAST  →  #BUKTI
```

Langkah `terima` itu web-only (F42, Admin Shipping/Kirim-Tagih) dan tak punya
hashtag, jadi `resetState()` menyetelnya langsung. Lihat catatan KEDALUWARSA di
`docs/features/F12-tracking-pengiriman-digital.md`.

## Batasan

- **Rantai view KSO `098`–`126` bisa gagal di DB dev yang sudah lama dipakai.**
  View dari migrasi lebih baru kadang sudah ada di luar `schema_migrations`,
  sehingga `DROP VIEW` di `098`/`107` gagal karena masih ada dependent. Aman
  dilewati — tak menyentuh jalur hashtag. Di DB **baru** ini tak terjadi (155/155
  apply bersih), jadi gejalanya menandai drift DB lama, bukan cacat migrasi.
- **`schema_migrations` di dev itu batas bawah, bukan kebenaran.** Objek bisa ada
  tanpa pernah tercatat (itu yang memicu konflik di atas). Kalau ragu, periksa
  objeknya langsung (`to_regclass`, `information_schema.columns`), jangan percaya
  ledger-nya saja.
- **Harness ini tidak menguji pengiriman WA.** `WA_SEND_URL` selalu dikosongkan;
  yang diverifikasi adalah teks balasan yang DISUSUN wrg-os, bukan bahwa pesannya
  benar-benar sampai ke WhatsApp. Jalur kirim nyata ada di `infra/wa-bridge/`.
