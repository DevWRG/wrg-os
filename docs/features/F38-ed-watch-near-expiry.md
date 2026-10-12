# F38 — ED Watch & Near-Expiry Alert (PURCHASING)

Pemantauan tanggal kedaluwarsa (ED) per batch + peringatan otomatis saat sisa
umur melintasi ambang **90 / 60 / 30 hari**, beserta saran alokasi.

- **Domain**: PURCHASING · FR-ES-38 · Tier R1 · MUST · Sprint B2
- **Owner (board)**: Yugo/Yugi · Denys · Pita · semua AM — terkonfirmasi di tabel
  `employee`: **Yugi** = Admin Gudang / PJ Barang (reagen & sparepart), **Denys**
  = Staf Gudang / Inventory, **Pita** = Leader Supply Chain. Persis orang yang
  sekarang memegang catatan lot-ED manual.
- **Menu**: `/inventory` → tab **"ED & Kedaluwarsa"** (tab ketiga; tidak ada menu
  baru)
- **Migrasi**: `infra/postgres/init/083_stock_batch_ed.sql`
- **Basis**: **di atas F37** (butuh master `warehouse` dari migrasi 082)

## 1. Kenapa tabel baru, dan hubungannya dengan F37

F37 melacak stok per item per **gudang**. F38 menambah dimensi ketiga —
**batch** — karena ED itu milik batch, bukan milik item: satu SKU bisa punya
beberapa batch ber-ED berbeda di gudang yang sama.

PK `item_stock_branch` (F37) adalah `(item_id, warehouse_kode)`. Menambah batch
berarti mengubah PK-nya dan memecah F37 yang sudah di-PR. Jadi tabel baru
`item_stock_batch` dengan PK `(item_id, warehouse_kode, batch_no)`.

**Keduanya sengaja TIDAK dipaksa saling menurunkan.** Cakupannya akan berbeda:
tidak semua SKU dilacak per batch (sparepart/alat tak punya ED), sementara opname
agregat per gudang mencakup semuanya. Kalau `item_stock_branch.quantity` dipaksa
jadi `SUM(batch)`, SKU tanpa batch jadi nol — salah. Kalau sebaliknya, angka batch
yang lebih detail tertimpa agregat. Jadi keduanya berdiri sendiri dan
**dikorelasikan**, pola yang sama dengan F37 vs total Accurate.

## 2. Gudang virtual di customer tidak ikut

Diwarisi dari F37 secara struktural, bukan diulang: `item_stock_batch.warehouse_kode`
ber-FK ke `warehouse(kode)`, dan **semua** query baca + cron memakai
`JOIN warehouse w ON … AND w.jenis = 'cabang'`. Importer juga membaca daftar kode
valid dengan `WHERE aktif AND jenis = 'cabang'`.

Jadi batch yang ada di gudang virtual customer tidak akan pernah ter-alert ke tim
gudang, dan CSV yang mencoba mengisinya ditolak.

## 3. Ambang 90/60/30 — kenapa penandanya ANGKA, bukan boolean

`item_stock_batch.alert_tier_terkirim` menyimpan **tier terkecil yang sudah
pernah diberitahukan** (90/60/30/**0**), atau NULL kalau belum pernah.

**Tier 0 = sudah lewat ED**, dan itu bukan tambahan kosmetik. Tanpa tier itu,
batch yang siklus alert-nya normal (90 → 60 → 30) **tak akan pernah diperingatkan
saat benar-benar kedaluwarsa**: tier-nya tetap 30 dan syarat `30 < 30` bernilai
false. Padahal justru di titik itulah saran berubah jadi `retur` — satu-satunya
saran yang butuh tindakan segera, dan yang dibutuhkan KPI gudang
"Barang expired → 0". Sebelum diperbaiki, label `retur` praktis hanya terkirim
untuk batch yang datanya masuk terlambat (belum pernah dialert sama sekali).

Alert dikirim hanya kalau tier saat ini **lebih kecil** dari yang tercatat.

Kenapa bukan kolom boolean per-ambang: kalau cron mati seminggu dan sebuah batch
melompat dari 65 hari ke 58 hari, ambang 60 **tetap berbunyi** (60 < 90/NULL).
Boolean per-ambang akan kehilangan lompatan itu — dan lompatan justru yang paling
mungkin terjadi saat cron sempat mati.

Konsekuensinya tiap ambang berbunyi **sekali**, bukan setiap hari selama 30 hari.

**ED yang diperbaiki MAJU me-reset penanda.** Kalau tanggal ED sebuah batch
dikoreksi jadi lebih jauh, importer mengosongkan `alert_tier_terkirim` supaya
ambangnya berbunyi ulang dari awal. Tanpa itu, batch tersebut tak akan pernah
diperingatkan lagi meski nanti mendekat kembali. ED yang mundur/sama tidak
me-reset (supaya tak ada pengulangan).

## 4. "KSO first, ED-short to trial" — apa yang bisa & tidak bisa dijanjikan

### Yang TIDAK ada di sistem

- **Registri kontrak KSO aktif per customer** — tidak ada. Tabel `kso_*`
  (migrasi 074) itu katalog harga Simulator KSO (analyzer/reagen/parameter/panel),
  bukan daftar kontrak berjalan.
- **Konsep "trial"** — dicari di seluruh skema, kode, dan docs: nihil. Tidak ada
  entitas trial/demo-unit/konsinyasi.

### Yang dipakai sebagai gantinya

Kategori pengadaan per baris faktur: `accurate_invoice_item.raw->>'charField1'`
bernilai `KSO`/`REGULAR`/`RUTIN`/`PL`/`ECAT`. Ini data produksi nyata — dipakai
view Per-Pengadaan (`sales-analytics.ts`). Dibaca dari `accurate_invoice_item`
(punya kolom `item_id`) alih-alih membongkar array
`accurate_invoice.raw->'detailItem'`, jadi jauh lebih murah untuk cron harian;
objeknya sama (`accurate_invoice_item.raw` = elemen `detailItem[]`, lihat
`accurateSync.ts:137`).

**Ini PETUNJUK, bukan keputusan** — dan ditulis begitu di UI maupun pesan WA:

- Cakupannya tidak 100% (ada bucket `Tanpa kategori`).
- Histori faktur ≠ komitmen kontrak yang sedang berjalan.

`saran_alokasi` adalah **output rekomendasi** (label), bukan FK ke entitas yang
belum ada. Urutannya mengikuti deskripsi board dengan satu tambahan di depan:

| Kondisi | Saran | Alasan |
|---|---|---|
| sisa < 0 | `retur` | sudah lewat ED — tak boleh dialokasikan ke mana pun |
| sisa ≤ 30 | `trial` | "ED-short to trial" |
| ada histori KSO | `kso` | "KSO first" |
| lainnya | `reguler` | — |

ED pendek **mengalahkan** KSO: batch 20 hari milik item ber-histori KSO tetap
disarankan ke trial/promo, bukan disimpan untuk KSO.

## 5. Cara kerja

- **Cron `ed-watch`** (`apps/api/src/repo/stock-batch.ts` `runEdWatch`), default
  `30 7 * * *` (07:30 WIB) — sudah masuk sebelum tim gudang menyiapkan kiriman.
- Memindai batch dengan `ed_date IS NOT NULL`, `quantity > 0`, `ed_date <=
  hari_ini + 90`, dan tier saat ini lebih kecil dari yang sudah diberitahukan.
- **`ed_date` NULL = barang non-kedaluwarsa** → tidak ikut alert, dan **bukan**
  dianggap "sudah lewat". Batch habis (`quantity = 0`) juga dilewati.
- Pesan WA **dikelompokkan per gudang** — tindakannya (relokasi/promo/retur)
  selalu per lokasi fisik, jadi daftar yang teracak antar-gudang tak bisa langsung
  dipakai.
- **⚠️ Tanggal pembanding dihitung di JS berbasis WIB**, bukan `current_date` SQL.
  Container Postgres ber-timezone `Etc/UTC`; dengan cron pagi (07:30 WIB = 00:30
  UTC) selisih harinya bisa bergeser satu dan seluruh perhitungan sisa-umur salah
  tanpa gejala. Pelajaran dari F45.
- **SENGAJA tidak dibungkus `isWorkday()`** — ED tidak berhenti jalan di hari
  libur, dan batch yang melintasi ambang tepat di awal libur panjang justru yang
  paling perlu diketahui lebih dulu.
- **Pesan dibatasi 40 baris batch** (paling mendesak dulu, sisanya diringkas
  "…dan N batch lainnya"). Tanpa cap, run pertama setelah import penuh bisa memuat
  seluruh batch ≤90 hari — pada katalog ~5.800 SKU itu ratusan KB, dan dua-duanya
  buruk: gateway menolak sehingga alert tak pernah lolos dan diulang tiap hari,
  atau WA memotong isinya sementara penanda tetap terbakar untuk baris yang tak
  pernah terbaca. Pola cap mengikuti `repo/notiftua.ts`.
- **Override `tanggal` di trigger manual TIDAK menandai** kecuali diminta
  eksplisit (`{"tandai": true}`). Itu alat uji ambang; kalau ia ikut menandai,
  satu panggilan bertanggal masa depan akan mencatat tier kecil ke batch produksi
  dan mematikan alert nyatanya selamanya.
- **`updated_at` tidak disentuh saat menandai alert.** Kolom itu berarti "kapan
  angkanya terakhir diperbarui" dan dipakai menandai data basi — mengirim alert
  bukan perubahan angka. Kalau ikut di-set, batch yang opname-nya 6 bulan lalu
  tampak segar hanya karena hari ini melintasi ambang. Waktu penandaan sudah
  dicatat `alert_terkirim_at`.
- **Query baca & cron juga menyaring `warehouse.aktif`**, bukan hanya
  `jenis='cabang'` — supaya simetris dengan importer. Migrasi 082 menonaktifkan
  gudang justru agar datanya tidak dipakai lagi; tanpa filter ini batch di sana
  tetap tampil dan tetap ter-alert sementara importer menolak menulis ke sana.
- **Anti-broadcast**: tanpa `ED_WATCH_WA_TARGET`, alert **tidak dikirim** dan
  tidak ditandai (`skipped: "no-target"`). Tidak pernah fallback ke grup besar.
- **Penanda tier hanya di-set kalau pesan BENAR-BENAR terkirim** — dan itu lebih
  ketat dari sekadar `gateway.sent`. `sendViaWaGateway` mengembalikan `sent: true`
  juga di dua mode yang tak mengirim apa pun: **stub** (`WA_SEND_URL` kosong) dan
  **DRY-RUN** — dan `WA_DRY_RUN` **default-nya `true`**. Kalau penanda dibakar di
  mode itu, urutan go-live yang ditulis repo sendiri (set target + nyalakan flag,
  `WA_DRY_RUN` masih true) akan menandai SEMUA batch ≤90 hari tanpa satu pesan
  terkirim — dan karena syaratnya `tier < yang tercatat`, ambang itu **tak akan
  berbunyi lagi selamanya**, hanya bisa dipulihkan lewat UPDATE SQL manual.
  `WA_TEST_TARGET` punya efek sama. Karena itu syaratnya
  `sent && !stub && !dryRun`, dan alasan skip dilaporkan spesifik
  (`stub-tidak-menandai` / `dry-run-tidak-menandai` / `gateway-gagal`).

### Env (semua default MATI)

| Env | Default | Fungsi |
|---|---|---|
| `ED_WATCH_ENABLED` | `false` | Nyalakan job |
| `ED_WATCH_CRON` | `30 7 * * *` | Jadwal (WIB) |
| `ED_WATCH_WA_TARGET` | *(kosong)* | Tujuan WA; kosong = tidak dikirim |

### Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/stock/batch` | daftar batch + sisa umur + tier + saran. Filter: `q`, `warehouse`, `tier=30\|60\|90`, `lewat=1`, `tanpa_ed=1`, `limit`, `offset` |
| GET | `/stock/batch/summary` | ringkasan per ambang + per gudang + tanggal WIB yang dipakai |
| POST | `/stock/batch/ed-watch/run` | trigger manual; body opsional `{"to":"…","tanggal":"YYYY-MM-DD"}` — `tanggal` untuk menguji lintas-ambang tanpa menunggu tanggal sungguhan bergerak |

## 6. Dua definisi ambang, dan kenapa keduanya ada

Ini sengaja, dan dijelaskan di UI supaya tidak jadi sumber kebingungan:

- **Kolom "Sisa" di tabel** memakai tier **kumulatif** (`≤30` termasuk yang sudah
  lewat) — karena itu yang menentukan kapan alert berbunyi.
- **Kartu ringkasan** memakai ember **saling lepas** (`sudah lewat` / `0–30` /
  `31–60` / `61–90` / `tanpa ED` / `>90`) — supaya angkanya **bisa dijumlahkan**
  pembaca dan cocok dengan total batch.

Versi pertama memakai `sisa <= 30` untuk kartu tier 30, sehingga batch yang sudah
lewat ED terhitung **dua kali** (di tier 30 dan di "sudah lewat"). Pembaca yang
menjumlahkan kartu tidak akan pernah cocok dengan total — persis jenis angka
tak-terekonsiliasi yang dihindari di F37.

## 7. Cara mengisi datanya

Data batch/ED **belum ada isinya** setelah merge. Diisi lewat importer, pola sama
F37 (data ini hidup di Excel tim gudang):

```bash
# CSV LONG — satu baris per batch (satu SKU bisa banyak batch di gudang sama):
#   sku,gudang,batch,ed,qty
#   IDS.0276,SBY,B2408-01,2026-11-30,120
#   IDS.0301,JEMBER,L-5521,,45          <- ed kosong = barang non-kedaluwarsa
python3 scripts/db/import_stock_batch.py --file batch.csv --db wrg_os_prod          # DRY-RUN
python3 scripts/db/import_stock_batch.py --file batch.csv --db wrg_os_prod --apply  # simpan

# Tanpa psql native (dev Windows, DB di Docker):
PSQL_BIN="docker compose exec -T postgres psql -U wrg" \
  python3 scripts/db/import_stock_batch.py --file batch.csv --db wrg_os
```

Semua pengaman hasil review F37 diwarisi: default DRY-RUN; idempoten by
`(item_id, warehouse_kode, batch_no)`; daftar gudang dibaca dari DB dengan gerbang
`jenis='cabang'`; SKU di luar mirror ditolak & dilaporkan; abort kalau **tidak
ada** SKU yang cocok (bukan "TERSIMPAN" + exit 0); qty negatif/bukan angka/ambigu
ditolak dengan menyebut baris & SKU; locale desimal tidak ditebak
(`--desimal koma|titik` untuk nilai ambigu seperti `1.500`); field ber-newline/
backslash ditolak (jalur eksekusi SQL lewat `\copy FROM STDIN`); stdin dikirim
UTF-8; `--hapus-tak-disebut` terbatas pada gudang yang hadir di CSV.

Tambahan khusus F38 hasil review:

- **Abort "nol SKU cocok" dilakukan DI DALAM transaksi** (`DO $$ … RAISE
  EXCEPTION`), bukan di Python setelah psql selesai. Versi awal mewarisi struktur
  F37 yang mengeceknya terlalu terlambat: body sudah `COMMIT`. Dengan
  `--hapus-tak-disebut`, CSV yang kolom `sku`-nya salah format seluruhnya (kolom
  `gudang` divalidasi terpisah sehingga tetap lolos) membuat `NOT EXISTS` bernilai
  true untuk SEMUA baris → seluruh batch gudang itu **terhapus dan ter-COMMIT**,
  lalu skrip mencetak "tak ada yang ditulis". Terukur di DB uji: 11 baris hilang
  sementara pesannya mengatakan tidak ada perubahan.
- **Reset penanda juga untuk kombinasi ED NULL → tanggal.** Versi awal mewajibkan
  kedua sisi NOT NULL, sehingga rantai ini bocor: batch dialert di tier 30 →
  gudang re-upload dengan kolom `ed` kosong (kelalaian umum, diterima sebagai
  "barang non-kedaluwarsa") → ED jadi NULL tapi penanda tetap 30 → CSV berikutnya
  mengisi ED yang benar → tidak ter-reset, dan batch itu tak akan pernah
  diperingatkan lagi.
- **`--hapus-tak-disebut` menolak jalan** kalau ada baris ber-qty KOSONG. Baris
  seperti itu dilewati (tak masuk staging), jadi batch-nya akan terhapus meski
  CSV menyebutnya lengkap dengan ED-nya — dan yang hilang termasuk penanda alert.
- **Laporan sebaran ambang memakai tanggal WIB**, bukan `current_date` container
  (UTC) — supaya tidak bergeser sehari dari angka di kartu saat import dijalankan
  antara 00:00–07:00 WIB.
- **`ed` divalidasi sebagai tanggal yang benar-benar ada** —
`2026-13-45` lolos pola `YYYY-MM-DD` tapi mati di cast `::date`, dan error-nya
akan muncul jauh dari nomor baris CSV penyebabnya. Divalidasi di Python supaya
pesannya menyebut baris & SKU. Tahun di luar 2000–2100 juga ditolak sebagai
kemungkinan salah ketik.

## 8. Hasil pengujian lokal

- Migrasi 083 diterapkan; idempoten (re-run aman). ✅
- Importer: sebaran ambang keluar benar dari CSV uji (1 lewat, 1 ≤30, 1 31–60,
  1 61–90, 1 >90, 1 tanpa ED); dry-run menulis 0 baris. ✅
- **Ember ringkasan saling lepas & bisa dijumlahkan**: lewat 1 + 0–30 1 +
  31–60 1 + 61–90 1 + tanpa ED 1 = 5, sisa 1 = batch >90 hari, total 6. ✅
- Cron: run pertama mengambil 4 batch (`per_tier` 90:1, 60:1, 30:2 — yang >90 hari
  dan tanpa ED **tidak** ikut); run kedua `count: 0` (idempoten). ✅
- **Lintas-ambang berbunyi ulang**: dengan `tanggal` disimulasikan 20 hari ke
  depan, batch yang tadinya tier 60 turun ke 30 dan berbunyi lagi (60→30),
  demikian pula 90→60. Yang sudah di ambang terkecil **tidak** berbunyi ulang. ✅
- **Petunjuk KSO**: setelah satu baris faktur diberi `charField1='KSO'`, batch
  item itu menampilkan `ada_histori_kso: true`, dan saran berubah jadi `kso` —
  kecuali batch 20-hari yang tetap `trial` (ED pendek mengalahkan KSO). ✅
- **ED diperbaiki maju** → `alert_tier_terkirim` ter-reset dari 30 ke NULL. ✅
- **Anti-broadcast**: tanpa target, `count: 4` tapi `notified: 0`,
  `skipped: "no-target"`, dan **tidak ada** tier yang ditandai. ✅
- **Wiring scheduler terverifikasi**: dengan `ED_WATCH_ENABLED=true`, log startup
  memuat `ed-watch=30 7 * * *` dan `/agents/schedule` melaporkan `enabled: true`
  (3 titik wajib di `scheduler.ts` benar). Env uji sudah dikembalikan. ✅
  **Catatan:** `status.jobs` di `/agents/schedule` hanya memuat agen A1–A12, jadi
  `ed-watch` TIDAK akan terlihat di daftar `jobs` endpoint itu — verifikasinya
  lewat log startup.
- Halaman `/inventory` 200 dengan tiga tab; proxy `/api/stock/batch*` 200.
- Typecheck · lint · build: bersih (termasuk aturan `react-hooks`).

### Hasil review adversarial (2 reviewer: frontend + backend/SQL/importer)

Semua temuan diperbaiki lalu diuji ulang. Yang paling parah:

- **Penanda tier terbakar walau WA tak pernah terkirim** — `sent: true` juga
  dikembalikan di mode stub & DRY-RUN (dan dry-run adalah DEFAULT). Mengikuti
  urutan go-live repo sendiri akan menandai semua batch tanpa satu pesan sampai,
  dan ambangnya mati permanen. **Klaim "retry-safe" di dokumen ini sebelumnya
  SALAH** dan sudah dikoreksi. Terverifikasi: stub → `notified: 0`,
  `skipped: stub-tidak-menandai`, 0 penanda terbakar; dengan gateway tiruan +
  `WA_DRY_RUN=false` → `notified: 3`, penanda tertulis benar.
- **Kedaluwarsa tak pernah memicu alert** untuk batch yang siklusnya normal
  (tier 30 → `30 < 30` false). Ditambah **tier 0**. Terverifikasi: batch ber-tier
  30 yang melewati ED berbunyi lagi di tier 0.
- **Importer menghapus lalu bilang "tak ada yang ditulis"** — abort dipindah ke
  dalam transaksi. Terverifikasi: 3 baris sebelum, **3 baris sesudah**, exit 1.
- **Rantai reset ED bocor** (tanggal → NULL → tanggal). Terverifikasi: langkah 1
  penanda dipertahankan, langkah 2 ter-reset ke NULL.
- **`updated_at` dirusak saat menandai** → indikator kesegaran data bohong.
  Terverifikasi utuh setelah run live.
- **Pesan tanpa batas panjang** → dibatasi 40 baris + ringkasan sisa.
- **Override `tanggal` menulis state permanen** → tidak menandai kecuali
  `tandai: true`. Terverifikasi: `skipped: tanggal-override-tanpa-tandai`,
  penanda tidak berubah.
- **`--hapus-tak-disebut` + baris qty kosong** → ditolak dengan pesan jelas.
- **Query baca tak menyaring `warehouse.aktif`** (asimetris dgn importer) → ikut
  disaring.
- **Panel macet permanen di layar error**: state hasil & error digabung jadi satu,
  jadi penulisan terakhir selalu menang.
- Plus tiga temuan frontend ringan (klaim komentar yang tidak akurat, kartu
  per-gudang yang hilang saat semua nol, pencarian saran alokasi yang memakai kode
  enum bukan label).

Reviewer juga mengonfirmasi yang **sudah aman**: tidak ada injection
(`sql.unsafe` konstanta, semua nilai terparameterisasi), gerbang gudang virtual
tak bocor di satu jalur pun (diuji dengan gudang `jenis='customer'` berisi batch
ED 5 hari), semua pengaman importer warisan F37 ada & terbukti, ember ringkasan
benar-benar saling lepas, migrasi idempoten, dan performa `KSO_HIST` **24 ms**
pada 120.000 baris faktur sintetis — bukan masalah untuk cron harian maupun page
load.

### ⚠️ Batas pengujian: pengiriman WA ke grup sungguhan belum diuji

Jalur live sudah diuji memakai **gateway tiruan lokal** (HTTP server yang menerima
POST dan membalas 200, dengan `WA_DRY_RUN=false`) — jadi yang terbukti: batch yang
jatuh tempo terpilih benar, pesan tersusun benar, POST benar-benar dikirim, dan
penanda ditulis hanya di jalur itu. Yang **belum** terbukti: pesan sampai di grup
WA sungguhan lewat openclaw, karena `ED_WATCH_WA_TARGET` memang belum ditentukan.

Ini status yang sama dengan F26 (code-complete, belum live), berbeda dari F8 yang
pipeline WA-nya sudah diverifikasi live. Uji live butuh `ED_WATCH_WA_TARGET`
ditentukan + `WA_DRY_RUN=false`.

### Catatan pengembangan yang layak diingat

Versi pertama panel ED memanggil fetch langsung di body komponen
(`if (!dimuat) muat()`) — itu **setState saat render** dan menyebabkan render
berulang. Diperbaiki jadi `useEffect` dengan seluruh `setState` **setelah**
`await`, ditambah flag `hidup` di cleanup supaya respons permintaan lama tidak
menimpa hasil filter baru. Keadaan "sedang memuat" **diturunkan** (hasil belum
untuk filter ini), bukan disimpan sebagai state tersendiri — jadi tak ada yang
perlu di-reset saat filter berganti.

## 9. Belum dikerjakan / perlu konfirmasi

1. **Ambang 90/60/30 diambil apa adanya dari deskripsi board.** Belum
   dikonfirmasi apakah itu memang lead-time yang tim gudang inginkan, atau perlu
   berbeda per kategori barang (reagen vs alkes bisa beda). Kalau perlu diubah,
   nilainya ada di `TIERS` (`stock-batch.ts`) dan CHECK constraint migrasi 083 —
   dua tempat, sengaja, supaya tak ada tier liar masuk DB.
2. **Tujuan WA belum ditentukan.** `ED_WATCH_WA_TARGET` masih kosong, jadi alert
   tidak akan terkirim sampai diisi. Sesuai aturan repo, target broadcast harus
   ditentukan user/Direktur — bukan diinferensi. Kandidat: grup Supply Chain
   (Pita/Denys/Yugi) atau personal Leader Supply Chain.
3. **"Trial" masih label, bukan alur.** Saran `trial` tidak membuat/menautkan
   apa pun karena entitasnya tak ada. Kalau nanti ada modul trial/demo-unit,
   saran ini bisa jadi tautan aksi.
4. **Petunjuk KSO belum bisa membedakan kontrak yang masih berjalan** dari yang
   sudah berakhir — sumbernya histori faktur. Registri kontrak KSO per customer
   akan memperbaikinya, tapi itu fitur terpisah.
5. **Belum ada UI input/koreksi per baris** (`source='manual'`). Sengaja: kalau
   nanti data batch bisa ditarik dari Accurate (`/api/stock-opname-*` ada di
   skema OpenAPI mereka), form manual justru menciptakan dua sumber kebenaran.
6. **Bergantung pada F37.** Tidak bisa merge sebelum F37 merge, karena
   `item_stock_batch.warehouse_kode` ber-FK ke `warehouse` (migrasi 082).
