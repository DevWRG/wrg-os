# F37 — Cross-Branch Stock Visibility (PURCHASING)

Stok per **gudang cabang WRG** + korelasinya ke angka stok total dari Accurate.

**12 gudang cabang** (arahan Direktur 2026-07-31, menggantikan daftar 5 di
board): Surabaya, Lamongan, Tuban, Jember, Kediri, Madiun, Madura, Jakarta,
Jogja, Solo, NTB, NTT.

> Jogja & Solo sempat disebut sebagai **satu** gudang (`JOGJASOLO`) di draft
> awal — Direktur minta dipisah jadi dua gudang berbeda (`JOGJA` / `SOLO`)
> sebelum fitur ini pernah dirilis, jadi tidak ada kode lama yang perlu
> dipertahankan.

> Direktur menyebutnya "surabaya 1" — angka 1 itu **jumlah**, bukan nomor urut
> ("konteks surabaya 1 itu maksudnya di surabaya ada 1 gudang"). Jadi tidak ada
> "Surabaya 2", dan kodenya `SBY` / namanya "Gudang Surabaya". Seed HR menyebut
> station "SBY 2" beberapa kali — itu station kirim-tagih, bukan gudang.

> ⚠️ **Gudang virtual di customer TIDAK ditampilkan.** Arahan Direktur:
> "kita ada jg gudang virtual yg ada di customer. Ini ndak masuk. Maksudnya
> selain gudang cabang kita, ndak usah di tampilkan stoknya." Ini punya
> konsekuensi pada cara membaca kolom selisih — lihat §2.

- **Domain**: PURCHASING · FR-ES-37 · Tier R1 · MUST · Sprint B2
- **Owner (board)**: Warehouse WRG (maintainer data) · all branch AM (pembaca)
- **Menu**: `/inventory` — **tidak ada menu baru**, menu yang ada jadi 2 tab
- **Migrasi**: `infra/postgres/init/082_cross_branch_stock.sql`

## 1. "Extends F2 SQC" — apa itu F2

Pencarian menyeluruh (1.185 commit di semua branch, seluruh docs, skema DB,
nama file) tidak menemukan fitur bernama "F2" atau "SQC" — satu-satunya
kemunculan literal string "SQC" adalah kebetulan base64 di `pnpm-lock.yaml`.

Klarifikasi dari pemilik fitur menjelaskannya:

> "F2 itu hanya fungsi untuk cek stok, dan di korelasikan dg stok yg ada di
> cabang. Jd sebenernya itu satu menu, tp 2 fungsi."

Jadi F2 **bukan fitur yang belum dibangun** — itu fungsi cek stok yang sudah
hidup di menu `/inventory` (baca `accurate_item.quantity`/`available`, satu
angka agregat per SKU untuk seluruh perusahaan). Konsekuensi desain: F37 **tidak
membuat menu baru**, dan tidak menambah key RBAC baru. `/inventory` jadi:

| Tab | Fungsi | Status |
|---|---|---|
| **Semua Stok** | cek stok agregat per SKU (yang di board disebut F2) | sudah ada, TIDAK diubah |
| **Per Gudang** | stok tiap gudang + korelasi ke total | baru (F37) |

## 2. Korelasi: kolom **Total − Σ Cabang**

Bagian "dikorelasikan dg stok yg ada di cabang" diterjemahkan menjadi tiga angka
per baris:

| Angka | Sumber |
|---|---|
| `total` | `accurate_item.quantity` — Accurate, **seluruh gudang** termasuk yang virtual di customer |
| per gudang | `item_stock_branch.quantity` — opname/import tim gudang, **hanya gudang cabang** |
| `selisih` | `total − Σ(per gudang)` |

### ⚠️ Cara membaca selisih — positif itu NORMAL

Karena gudang virtual di customer sengaja tidak ditampilkan sementara stoknya
tetap ikut terhitung di `accurate_item.quantity`, keadaan `total ≥ Σ(cabang)`
adalah **normal**, bukan tanda data rusak. Selisih positif punya dua sebab yang
**tidak bisa dipisahkan** dari data yang kita punya sekarang:

1. Barang memang sedang berada di customer (wajar), **atau**
2. Data gudang cabang belum lengkap/basi (perlu ditindak).

Karena itu selisih positif ditampilkan **netral**, bukan merah. Menandainya
merah akan menuduh setiap item yang punya penempatan di customer sebagai
"data bermasalah" — dan setelah beberapa kali salah alarm, orang berhenti
mempercayai kolomnya.

Yang **benar-benar mustahil** adalah selisih **negatif**: stok gudang cabang tak
mungkin melebihi total perusahaan. Itu satu-satunya sinyal integritas yang tegas
di sini, dihitung terpisah (`item_selisih_negatif` di ringkasan, badge merah di
tabel, filter `?negatif=1`).

Tiga keadaan sel kolom gudang dibedakan tegas, karena artinya berbeda:

- `—` → **belum diisi** (tidak ada baris `item_stock_branch`)
- `0` → **sudah dihitung, hasilnya habis**
- angka → stok tercatat

Kalau keduanya disamakan, "gudang belum melapor" jadi tak bisa dibedakan dari
"barang habis" — dua kesimpulan yang tindakannya berlawanan.

Di atas tabel ada ringkasan kesehatan data (cakupan %, item tanpa data, item
`total > Σ cabang`, item `Σ cabang > total`, kapan data terakhir masuk) plus
ringkasan per gudang. Gudang yang belum punya satu pun baris stok tetap tampil
dengan 0 (LEFT JOIN dari `warehouse`) — kalau di-INNER JOIN, gudang yang datanya
belum diisi hilang dari ringkasan dan kelihatan seolah tak ada masalah.

Kolom matriks memuat gudang **aktif** (`/stock/warehouses?aktif=1`) **ditambah**
gudang nonaktif yang masih memegang stok di salah satu baris. Penambahan itu
bukan hiasan: migrasi 082 sengaja **menonaktifkan, bukan menghapus** gudang, jadi
tiap gudang ditutup/digabung pasti menghasilkan keadaan ini. Tanpa kolom
penampung, stok di gudang nonaktif tetap ikut Σ Cabang tapi tak punya kolom —
pembaca menjumlahkan kolom yang terlihat dan hasilnya **tidak cocok dengan Σ**,
tanpa cara apa pun melacak sisanya. Untuk kolom Selisih yang jadi dasar keputusan
relokasi, angka yang tak bisa direkonsiliasi lebih merusak daripada tidak ada
angka. Ringkasan juga tetap menampilkan gudang nonaktif, ditandai "(nonaktif)".

### Data tab 2 diambil saat tab dibuka

Matriksnya ~1,3 MB pada katalog 5.800 item dan tab-nya **default tertutup**, jadi
prefetch berarti pemakai tab "Semua Stok" ikut menanggung 1,3 MB yang tak pernah
dilihatnya (halaman terukur 3 MB / 2,8 s sebelum diperbaiki). Sekarang komponen
tab mengambilnya lewat proxy `/api/stock/*` saat tab diaktifkan — terverifikasi
`per_gudang`/`jumlah_cabang` tidak lagi ada di payload awal halaman.

Efek sampingnya bagus: filter anomali (`?negatif=1`) dan "belum ada data cabang"
(`?tanpa_data=1`) bisa dijalankan **di server** lewat tombol di UI. Sebelumnya
ringkasan bilang "data perlu dicek" tanpa satu pun cara menuju barisnya.

## 3. Kenapa tabel baru, bukan kolom di `accurate_item`

`accurate_item` PK-nya `id` **tunggal**, satu baris per SKU — secara struktural
tak bisa menyimpan breakdown per gudang. Puller-nya juga memakai field whitelist
(`fields=id,no,name,itemType,unitPrice,quantity,availableToSell,unit1` di
`accurateSync.ts`), jadi kolom `raw` pun tidak memuat data gudang.

`accurate_branch` juga tidak bisa dipakai sebagai master gudang: kolom `name`
tidak pernah diisi puller (tidak ada `syncBranches()`), dan
`accurate_invoice.branch_id` konstan 50 — lihat komentar di
`apps/api/src/repo/sales.ts`. Karena itu master gudang dibuat sendiri.

### `warehouse` = ALLOWLIST, dan kolom `jenis` yang menegakkannya

Gudang virtual di customer **ada di Accurate** dan akan ikut terbawa kalau puller
menarik seluruh daftar gudang apa adanya. Menyandarkan aturan ini pada *isi*
tabel saja tidak cukup: puller yang melakukan `INSERT … ON CONFLICT DO UPDATE` ke
`warehouse` — bentuk paling alami untuk sebuah mirror — membuat gudang customer
terlihat dalam satu langkah, dan penghitung agregat menyerapnya ke Σ Cabang
sebelum ada yang sadar ada kolom baru.

Karena itu ada kolom **`jenis`** (`'cabang'` / `'customer'`), **NOT NULL tanpa
default**, dan **query baca menggerbanginya**:

- `listWarehouses()` → `WHERE jenis = 'cabang'`
- matriks & ringkasan → gerbangnya ditaruh di **kondisi JOIN** `item_stock_branch`
  (`AND sb.warehouse_kode IN (SELECT kode FROM warehouse WHERE jenis='cabang')`),
  bukan sebagai LEFT JOIN terpisah ke `warehouse` — dengan LEFT JOIN, baris stok
  yang gudangnya bukan cabang tetap lolos (hanya `w`-nya yang NULL) sehingga tak
  menyaring apa pun.
- importer → daftar kode valid dibaca dengan `WHERE aktif AND jenis = 'cabang'`.

**Tanpa default itu disengaja.** `DEFAULT 'cabang'` akan membuat insert lalai
justru terlihat — kebalikan dari tujuannya. `DEFAULT 'customer'` juga tidak
dipilih karena menyembunyikan gudang cabang baru secara senyap. Wajib eksplisit =
puller yang lupa gagal keras (NOT NULL violation), bukan membocorkan data.

Terverifikasi empiris: gudang `jenis='customer'` berisi 777 unit tidak muncul di
daftar gudang, tidak masuk `per_gudang`, tidak masuk Σ Cabang, `source`-nya pun
tidak ikut — dan CSV yang berkolom kode gudang customer ditolak importer.

Kode draft sebelum arahan Direktur — `PUSAT`/`KEMANGI` (dari deskripsi board yang
usang) dan `SBY1` (dari draft yang salah membaca "surabaya 1" sebagai nomor urut)
— **dinonaktifkan, bukan di-DELETE**: kalau ada instalasi yang sempat mengisi stok
dengan kode itu, DELETE akan menghapus datanya lewat `ON DELETE CASCADE`.
`aktif=false` sudah cukup: importer hanya menerima gudang aktif, UI menandainya
"(nonaktif)".

## 4. Sumber data — sengaja *pluggable*

Kolom `item_stock_branch.source` menandai asal tiap angka:

| source | Artinya |
|---|---|
| `import` | dari CSV/Excel tim gudang via `scripts/db/import_stock_branch.py` |
| `manual` | koreksi per baris (slot disediakan, UI-nya belum dibangun) |
| `accurate` | dari `syncItemStockBranch()` (job `stok-gudang-sync`, harian) — lihat di bawah |

### Puller Accurate — SUDAH DITULIS (Sep 2026), harian bukan real-time

> Dua pertanyaan yang dulu menahan bagian ini sudah dijawab probe di prod
> (#836) — **2026-09-05** dan diverifikasi ulang **2026-09-06**. Riwayat
> pertanyaannya disimpan di bawah karena jawabannya mengubah bentuk fiturnya,
> bukan cuma mengisi kekosongan.

**Jawaban pertanyaan 1 & 2: keduanya YA.** `warehouse/list.do` jalan, **109
gudang** terbaca — modul multi-gudang aktif dan user API berizin.

**Tapi saldo per gudang tidak tersedia secara bulk.** Yang diuji dan hasilnya:

| Jalur | Ongkos | Hasil |
|---|---|---|
| `item/list.do` + field/filter gudang (5 varian) | ~59 panggilan | ❌ balas 200 `s=true`, tapi kunci baris tetap `{id,no,name,quantity}` — `detailWarehouseData`/`warehouseData`/`sp.warehouseId`/`filter.warehouseId` **diabaikan diam-diam** |
| `warehouse/detail.do` | ~13 panggilan | ❌ metadata gudang saja, nol saldo SKU |
| `item/detail.do` per SKU | **~5.900 panggilan** | ✅ `detailWarehouseData` array(110): `warehouseName`, `balance`, `unit1..5Quantity` |
| `item/get-stock.do` | — | ❌ hanya `{availableStock}`, agregat |
| `stock-mutation` / `warehouse-mutation` / `stock-mutation-history` / `stock-opname` / `stock-adjustment` | — | ❌ semua **404 "URL API tidak tepat"** |

Satu panggilan `item/detail.do` membawa **semua** gudang untuk SKU itu, jadi
ongkosnya jumlah-item — bukan jumlah-item × jumlah-gudang. Tetap ±5.900
panggilan untuk sapuan penuh.

**Konsekuensinya bentuk fiturnya berubah: HARIAN, bukan real-time.** #836
di-re-scope (judulnya ikut diganti), **bukan** ditutup sebagai limitasi permanen
— yang terbukti "kandidat yang dicoba tidak membawanya", bukan "Accurate tak
punya".

#### Yang dibangun

- **Migrasi `166_warehouse_accurate_map.sql`** — tabel `warehouse_accurate`
  (id Accurate → kode kita) + kolom `accurate_item.stock_synced_at`.
- **`syncItemStockBranch()`** di `accurateSync.ts` — berbatas per run, melanjutkan
  dari SKU paling lama tak tersegarkan.
- **`POST /accurate/sync/stock-branch?limit=`** — manual/catch-up.
- **Job `stok-gudang-sync`** — harian 02:00, flag `STOCK_BRANCH_SYNC_ENABLED`.

#### Tiga keputusan pemilik fitur (2026-09-06) yang dikodekan di migrasi 166

1. **Allowlist pakai ID**, bukan nama/flag. Dua heuristik yang sempat masuk akal
   TERBUKTI BOCOR: `suspended` bernilai `false` untuk **seluruh 109 baris**
   (termasuk TEMPORARY & PUSAT NOT AVAILABLE), dan prefix nama `GUDANG` ikut
   menangkap SPAREPART KSO, TEMPORARY, dan dua PUSAT. Dari 13 baris berawalan
   GUDANG, hanya 8 operasional.
2. **Tiga gudang Surabaya dijumlahkan** ke satu kode `SBY` (id 100, 2250, 200).
3. **Lima cabang di-skip** — LAMONGAN, TUBAN, JOGJA, SOLO, NTT tak punya padanan
   di Accurate, jadi sengaja tak dipetakan. Stok mereka tetap dari CSV.
   **NTB menyusul jadi yang keenam** — lihat "Pemetaan NTB dicabut" di bawah.

#### Kenapa TABEL pemetaan, bukan kolom `warehouse.accurate_warehouse_id`

Bentuk kolom (yang disarankan kedua probe, dan dicatat di versi doc sebelumnya)
benar sampai keputusan Surabaya turun. Accurate punya **tiga** gudang Surabaya
sementara di kita cuma satu kode `SBY` — satu kolom tak bisa menampung tiga id,
dan memaksakannya berarti dua gudang Surabaya diam-diam tak pernah ikut terbaca.
Pemetaannya BANYAK→SATU, jadi tabel.

#### Akibat yang harus disadari: tabel ini kini BERCAMPUR dua sumber

Gudang yang dipetakan tersegarkan otomatis (`source='accurate'`); enam cabang
yang di-skip tetap memakai CSV opname (`source='import'`). Karena itu
`stockBranchSummary()` sekarang ikut mengembalikan `sumber[]` **per gudang**,
dan kartu ringkasan menampilkannya — tanpa label, dua-duanya tampil sebagai
angka yang sama meyakinkan.

Cakupan hapus puller sengaja dibatasi ke gudang yang dipetakan: baris CSV milik
cabang yang di-skip **tidak** ikut terhapus oleh puller yang tak punya angka
untuk mereka. Untuk gudang yang dipetakan, Accurate menang — baris `import` lama
digantikan.

#### Pemetaan NTB DICABUT (migrasi 167)

Migrasi 166 sempat memetakan `NTB → GUDANG MATARAM` (id 600) atas dasar
**kecocokan nama saja** — Mataram ibu kota NTB — dan komentarnya sendiri
menandai baris itu belum dikonfirmasi siapa pun. Pemilik fitur memutuskan
**2026-09-06: cabut sampai ada yang mengonfirmasi**, dan itu dikerjakan migrasi
`167_warehouse_accurate_hapus_ntb.sql`.

Alasannya bukan kerapian. Pemetaan yang salah **tidak memunculkan error**:
puller akan menulis saldo gudang Mataram ke kolom NTB, angkanya tampil rapi di
matriks, dan satu-satunya cara ketahuannya adalah ada orang yang kebetulan
hafal stok NTB. Kolom yang jujur kosong lebih baik daripada tebakan yang gagal
dalam diam.

Jadi allowlist sekarang **8 id → 6 kode** (`SBY` ×3, KEDIRI, MADURA, MADIUN,
JAKARTA, JEMBER), dan NTB berperilaku persis seperti lima cabang tanpa padanan:
puller tak menyentuhnya, stoknya tetap dari CSV.

**167 additive, bukan mengedit 166** — dan itu disengaja. 166 sudah merged serta
sudah dijalankan di setidaknya satu database; ledger `schema_migrations` memakai
NAMA FILE, jadi mengedit isinya tak akan pernah dieksekusi ulang di database yang
sudah mencatatnya — barisnya akan tetap ada di sana, diam-diam. Yang additive
benar untuk kedua populasi: database baru menjalankan 166 lalu 167 (bersih di
akhir run), database lama cukup menjalankan 167.

Kalau nanti ada yang mengonfirmasi GUDANG MATARAM memang gudang NTB:
kembalikan lewat **migrasi baru**, jangan menghidupkan kembali baris di 166.

#### Riwayat: kenapa dulu sengaja belum ditulis

Skema OpenAPI Accurate (`account.accurate.id/open-api/json.do`) menyebut
`/api/warehouse`, `/api/stock-mutation-history-view`, `/api/stock-opname-*`,
`/api/item-transfer`. ⚠️ Itu penamaan skema OpenAPI, **bukan** bentuk yang kita
panggil — pola yang hidup di `accurateSync.ts` adalah
`https://<host>/accurate/api/<entity>/list.do`. Probe ke path REST kena 404, dan
404 itu gampang disalahbaca sebagai "tak diizinkan" → orang lompat ke kesimpulan
"modul multi-gudang mati" padahal yang salah cuma path-nya. Terbukti relevan:
seluruh varian mutasi/opname memang 404, dan itu **bukan** soal izin.

Dua hal yang dulu belum terverifikasi (keduanya butuh kredensial prod):

1. Apakah langganan Accurate WRG mengaktifkan multi-gudang, dan apakah **12
   gudang cabang** di seed 082 benar terdaftar di sana.
2. Apakah user API kita punya izin ke endpoint tersebut.

Probe-nya: `scripts/qa/probe-accurate-warehouse.mjs` (izin & daftar gudang) dan
`scripts/qa/probe-accurate-stok-gudang.mjs` (mana endpoint yang membawa saldo +
berapa ongkosnya). READ-ONLY, memakai `loadCreds()`/`accGet()` berpola identik
`accurateSync.ts`, jadi "jalan di probe" berarti "jalan juga di puller".
Dijalankan di Mac mini; token/secret tak pernah dicetak. Ingat: **Accurate
membalas HTTP 200 dengan `s=false` untuk kegagalan logis**, termasuk penolakan
izin — status HTTP saja tak cukup menyimpulkan apa pun.

#### Catatan yang sudah tidak berlaku

Versi doc sebelumnya menyebut puller per-gudang bertempat di job
`accurate-stock-sync` (tiap 5 menit). **Itu tidak jadi** — ±5.900 panggilan per
siklus akan membanjiri API Accurate dan menabrak job lain yang memakai
kredensial sama. Puller berdiri sebagai job sendiri, `stok-gudang-sync`, harian
02:00, dengan flag terpisah yang TIDAK ikut `AGENT_SCHEDULE_ENABLED` — job ini
menulis ke tabel yang punya sumber lain (CSV tim gudang), jadi menyalakannya
harus keputusan sadar.

Aturan allowlist di header 082 tetap berlaku dan kini ditegakkan lewat
`warehouse_accurate`: jangan auto-insert gudang baru dari respons Accurate. Itu
persis cara stok gudang virtual milik customer bocor ke layar AM.

### Kenapa importer, bukan form di web

Stok per gudang itu data milik tim gudang yang hidupnya di Excel — pola yang
sama sudah dipakai Price Book, Klasifikasi Produk, dan KSO master (semuanya
importer). Mengetik ulang ribuan SKU × 12 gudang lewat form bukan alur realistis.

## 5. Cara pakai importer

```bash
# Format WIDE (satu baris per SKU, satu kolom per gudang):
#   sku,PUSAT,KEMANGI,SBY,MADIUN,JEMBER
#   IDS.0276,120,0,45,,12
python3 scripts/db/import_stock_branch.py --file stok.csv --db wrg_os          # DRY-RUN
python3 scripts/db/import_stock_branch.py --file stok.csv --db wrg_os --apply  # simpan

# Format LONG: sku,gudang,qty
python3 scripts/db/import_stock_branch.py --file stok.csv --db wrg_os --long --apply

# Tanpa psql native (dev Windows, DB di Docker):
PSQL_BIN="docker compose exec -T postgres psql -U wrg" \
  python3 scripts/db/import_stock_branch.py --file stok.csv --db wrg_os
```

Perilaku yang disengaja:

- **Default DRY-RUN** (`BEGIN` … `ROLLBACK`) — hanya laporan, tidak menulis.
  `--apply` untuk commit. `--db` wajib disebut: "berhasil" ke database yang
  salah adalah kegagalan yang paling gampang tidak disadari.
- **Angka desimal TIDAK ditebak locale-nya.** Ada kedua separator → yang terakhir
  muncul jadi pemisah desimal (`1.234,56` → 1234,56). Hanya `,` → pemisah desimal.
  Hanya `.` diikuti **tepat 3 digit** → **ambigu** (`1.500` bisa 1500 atau 1,5) →
  **ditolak**, kecuali operator menyatakan `--desimal koma|titik`. Selain itu `.`
  = pemisah desimal (`1.5` → 1,5).
  Versi draft memperlakukan setiap titik sebagai pemisah ribuan sehingga CSV
  ber-locale en-US (default ekspor Google Sheets) merusak angka **tanpa satu pun
  pesan**: `1.5`→15, `0.5`→5, `1,234.56`→1,23456. Kesalahan 10× pada stok ikut
  memproduksi "anomali selisih negatif" yang katanya mustahil.
- **`sku`/kode gudang ber-newline atau backslash → DITOLAK.** Ini bukan
  kerapian: data dikirim lewat `\copy … FROM STDIN`, psql mendeteksi terminator
  COPY di sisi **klien** (baris berisi tepat `\.`) dan **tidak menghormati quoting
  CSV**. Jadi sku ber-newline bisa menutup COPY lalu menyuapkan SQL sembarang ke
  psql — dan dengan `--apply` itu ikut COMMIT, terhadap `wrg_os_prod`.
- **stdin dikirim UTF-8 eksplisit.** Tanpa itu Python memakai encoding locale
  (cp1252 di Windows) dan importer mati `UnicodeEncodeError` begitu ada karakter
  non-Latin1 — termasuk nama SKU beraksen.
- **Abort kalau TIDAK ADA satu pun SKU yang cocok** ke `accurate_item`, dan
  jumlah baris yang benar-benar tertulis ikut dicetak. Sebelumnya skrip mencetak
  "TERSIMPAN" dan exit 0 padahal 0 baris masuk — `sku_ditolak=N` lewat di tengah
  output psql yang panjang.
- **Header ber-spasi & kolom gudang duplikat ditangani.** `"sku, SBY"` dulu lolos
  validasi lalu melempar `KeyError` telanjang (key DictReader adalah fieldname
  asli yang belum di-strip). `"sku,SBY,SBY"` dulu membuang salah satu angka tanpa
  pesan (DictReader meruntuhkan key duplikat ke nilai terakhir); sekarang ditolak.
- **Idempoten** by `(item_id, warehouse_kode)` → re-import file yang sama =
  UPDATE, bukan duplikat.
- **Daftar gudang dibaca dari DB**, bukan dihardcode — kalau master gudang
  berubah, importer ikut tanpa diedit.
- **Kolom gudang tak dikenal → DITOLAK**, bukan diabaikan diam-diam. Typo header
  berarti seluruh kolom stok hilang tanpa jejak.
- **Sel kosong ≠ 0**: kosong = tidak ada data (baris tidak ditulis), 0 = sudah
  dihitung dan hasilnya habis.
- **SKU tak ada di `accurate_item` → ditolak & dilaporkan** (bukan dibuat
  diam-diam): mirror adalah master item, stok untuk SKU hantu tak bisa
  dikorelasikan ke apa pun.
- **qty negatif / bukan angka → tolak** dengan nomor baris & SKU-nya.
- **Duplikat `(sku,gudang)` bernilai beda di satu file → tolak**: kalau
  dibiarkan, yang menang tergantung urutan baris dan hasilnya tak reprodusibel.
- **CSV parsial = tambahan, bukan pengganti.** Baris yang tidak disebut CSV
  dibiarkan; pakai `--hapus-tak-disebut` kalau memang mau perilaku pengganti —
  dan itu **terbatas pada gudang yang kolomnya hadir di CSV**. Versi draft
  menghapus semua kombinasi yang tak ada di CSV tanpa batasan gudang: CSV opname
  **satu** cabang (bentuk paling wajar) menghapus seluruh gudang lain — terukur
  **10.443 dari 13.923 baris**, termasuk koreksi `source='manual'`. Jumlah baris
  yang akan dihapus sekarang dicetak sebelum commit.
- Data dikirim inline lewat `\copy FROM STDIN`, bukan file temporer — `\copy
  FROM '<path>'` menaruh path apa adanya di string SQL dan path Windows
  (`C:\Users\…`) langsung rusak karena backslash.

## 6. Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/stock/warehouses` | master gudang (`?aktif=1` untuk yang aktif saja) |
| GET | `/stock/branch` | matriks item × gudang + korelasi. Filter: `q`, `warehouse`, `selisih=1` (total ≠ Σ cabang), `negatif=1` (Σ cabang > total — anomali), `tanpa_data=1`, `limit`, `offset` |
| GET | `/stock/branch/summary` | kesehatan data + ringkasan per gudang |

Read-only — data masuk lewat importer, bukan lewat endpoint. `?warehouse=`
divalidasi terhadap master: kode tak dikenal → 400 beserta daftar kode valid,
bukan "0 baris" yang menyesatkan (kelihatan seperti "gudang ini kosong").

Matriks memakai LEFT JOIN dari `accurate_item` supaya item yang belum punya data
cabang **tetap muncul** — itu justru informasi penting (cakupan data masih
bolong), bukan sesuatu yang boleh disembunyikan INNER JOIN.

Catatan kontrak:

- `?selisih=1` berarti **`total > Σ cabang`** (positif saja), sengaja dibuat sama
  dengan kartu ringkasan berlabel "Total > Σ cabang" — pemakai men-drill dari
  kartu itu. Versi draft memakai `<>` sehingga mengembalikan 3.480 baris untuk
  kartu yang menampilkan 2.116, 64% lebih banyak dari angka yang diklik. Untuk
  yang negatif ada `?negatif=1`.
- `total_rows` benar walau halaman kosong. `count(*) OVER ()` sendiri sudah benar
  (window dievaluasi sebelum LIMIT), tapi nilainya hanya bisa dibaca dari baris
  hasil — dengan `offset` melewati akhir data, `total_rows` dulu jadi 0 dan klien
  paging tak bisa membedakan "kelewat jauh" dari "memang tak ada data". Sekarang
  fungsi memanggil dirinya sendiri (offset 0, limit 1) untuk kasus itu, alih-alih
  menulis query count terpisah yang bisa menyimpang dari filternya.
- Clamp limit **20.000** (bukan 5.000). Halaman meminta 10.000; clamp 5.000 dulu
  memotongnya diam-diam sehingga ±800 SKU ekor `ORDER BY no` (480 di antaranya
  **punya** data stok) hilang permanen, dan pencarian client-side melaporkan
  "tidak ada" untuk SKU yang sebenarnya ada.

## 7. Hasil pengujian lokal

- Migrasi 082 diterapkan; **12 gudang cabang** ter-seed aktif, kode draft
  (`PUSAT`/`KEMANGI`/`SBY1`) dinonaktifkan bila ada. Idempoten (re-apply aman). ✅
  <br>*(Koreksi 2026-09-04: baris ini semula menulis "tepat 11". Salah hitung —
  seed 082 memuat 12 baris `jenis='cabang'` sejak commit pertamanya `d7b89638`
  dan tak pernah berubah; `wrg_os_dev` juga 12. Angka 11 ikut menyebar ke brief
  F37 yang beredar, jadi dikoreksi di sumbernya.)*
- Importer membaca daftar gudang dari DB: kode kanonik (`SBY`, `LAMONGAN`, …)
  diterima; header memakai kode draft `SBY1` → **ditolak** beserta daftar kode
  valid. ✅
- **Anomali selisih negatif terdeteksi**: `DEMO-ITM-0002` diisi Σ cabang
  1.000.010 vs total 5.000 → `selisih: -995.010`, `item_selisih_negatif: 1`,
  filter `?negatif=1` mengembalikan baris itu. Setelah data dinormalkan kembali:
  `selisih_negatif: 0`. ✅
- Kolom matriks hanya gudang aktif — `PUSAT` tidak muncul sebagai kolom, tapi
  tetap ada di ringkasan kalau memegang stok. ✅
- Importer DRY-RUN: laporan keluar, **0 baris tertulis** ke DB. ✅
- `--apply`: 6 baris masuk; re-apply file sama → tetap 6 baris (idempoten);
  nilai diubah 120→999 → UPDATE, bukan duplikat. ✅
- SKU hantu (`SKU-HANTU-999`) dilaporkan di section "ditolak" dan tidak masuk. ✅
- Validasi tolak: kolom gudang tak dikenal, qty negatif, qty bukan angka, kolom
  pertama bukan `sku`, duplikat `(sku,gudang)` bernilai beda (format `--long`).
  Semua dengan pesan yang menyebut baris & SKU-nya. ✅
- Korelasi: `DEMO-ITM-0001` total 320 vs Σ cabang 177 → selisih 143;
  `DEMO-ITM-0003` tanpa data cabang → `ada_data_cabang: false`. ✅
- Filter API: `selisih=1` → 2 baris, `tanpa_data=1` → 8 baris,
  `warehouse=MADIUN` → 1 baris, `warehouse=NGAWUR` → 400 + daftar kode valid,
  `q=ITM-0001` → 1 baris. ✅
- Halaman `/inventory` 200; tab "Semua Stok" & "Per Gudang" tampil; payload RSC
  memuat `cakupan_persen: 20`, ringkasan per gudang, dan matriks. ✅
- Typecheck · lint · build: bersih.

### Hasil review adversarial (2 reviewer, temuan diperbaiki lalu diuji ulang)

Diverifikasi di DB berisi **5.800 item + 13.923 baris stok** (skala katalog
sungguhan), bukan di data demo:

- **Performa bukan masalah**: matriks 5.000 baris **37 ms**, ringkasan **7 ms**,
  nol disk read. Tidak ada index yang kurang. Biaya nyatanya di payload, dan itu
  yang diperbaiki lewat fetch-on-open (halaman 3 MB → tab 2 tidak lagi
  di-prefetch sama sekali).
- **`parse_qty`**: `1.5` → 1,50 (dulu 15). `1.234,56` → 1234,56. `1.500` →
  ditolak sebagai ambigu; dengan `--desimal koma` → 1500.
- **Breakout `\copy`**: payload sku ber-newline + `\.` + `DROP TABLE` → ditolak
  sebelum stream dibangun.
- **`--hapus-tak-disebut`**: CSV berkolom SBY saja → menghapus tepat 1 baris SBY
  yang tak disebut; JEMBER/KEDIRI/LAMONGAN/NTT **utuh**.
- **Semua SKU ditolak** → exit code 1 + pesan jelas (dulu "TERSIMPAN", exit 0).
- **Gerbang `jenis`**: gudang `customer` berisi 777 unit tak terlihat di daftar
  gudang, `per_gudang`, Σ Cabang, maupun `sumber`; CSV berkolom kode itu ditolak.
- **`total_rows`** dengan `offset=99000` → 5.800 (dulu 0).
- **Kartu vs filter** kini cocok: `item_selisih` = `?selisih=1 total_rows`.
- **Pencarian**: kolom numerik ber-sentinel di-set `searchable: false` di
  `DataTable`. Dulu 12 kolom memakai `-1`, sehingga mengetik "1" mencocokkan
  SEMUA baris dan filter berhenti bekerja. Flag-nya opsional (default `true`), jadi
  tabel lain tak berubah perilaku.
- **Sentinel sort** `-MAX_SAFE_INTEGER`, bukan `-1` (bisa bentrok qty negatif
  sungguhan) dan bukan `-Infinity` (`av - bv` → `NaN` → urutan tak terdefinisi).
- **`CHECK (quantity >= 0)`** ditambahkan di DB, bukan cuma di importer — jalur
  `source='manual'`/SQL langsung juga harus tertahan.
- **`quantity` NULL** (item non-stok/jasa): tabel menampilkan badge "total belum
  sinkron" (dulu `+—`), dan ringkasan **tidak lagi** menghitungnya sebagai anomali
  merah — dulu `COALESCE(quantity,0)` membuat kartu merah menunjuk baris yang di
  tabel tampil netral, jadi angkanya tak bisa dilacak.
- **Aksesibilitas tab**: `role="tablist"/"tab"`, `aria-selected`, `aria-controls`,
  dan status aktif tidak lagi hanya lewat warna.
- **Kolom SKU sticky** — matriks bisa >1.900px sementara area konten ~1.150px;
  tanpa sticky, SKU ter-scroll keluar dan angkanya kehilangan identitas baris.
- **Tab 2 tidak lagi ikut hilang** kalau fetch tab 1 gagal (dulu gate `!items` di
  `page.tsx` mematikan seluruh halaman, padahal `/accurate/items` request
  terberat & paling mungkin timeout). Kedua EmptyState lama tetap dibedakan.
- **Kegagalan `/stock/warehouses` tidak lagi ditelan** jadi array kosong yang
  membuat halaman tampak lengkap tanpa kolom gudang — sekarang diberi peringatan
  eksplisit.
- **Banner pemotongan** muncul kalau `rows.length < total_rows`.

Temuan yang **sengaja tidak diubah**: `scopeOf(c)` tidak dipakai — konsisten
dengan `/accurate/:entity` yang menyalakan tab 1, dan inventory adalah data
perusahaan tanpa `am_id` untuk di-scope. `ON DELETE CASCADE` dari `accurate_item`
dibiarkan (tak ada kode yang menghapus dari mirror hari ini; dicatat di §8 sebagai
risiko laten). State tab tidak disimpan di URL.

## 8. Belum dikerjakan / perlu konfirmasi

1. **Gudang pusat/Kemangi tidak muncul sebagai baris terpisah.** Daftar 11 tidak
   menyebut "Pusat" maupun "Kemangi", padahal seed HR
   (`053_seed_employee_spine.sql`) menulis lokasi Yugi (Admin Gudang / PJ Barang)
   sebagai **"Gudang pusat (Kemangi)"**. Karena Surabaya dikonfirmasi hanya punya
   **satu** gudang dan Kemangi berada di area Surabaya, kesimpulan yang paling
   masuk akal: `SBY` inilah gudang pusat di Kemangi itu. Belum dikonfirmasi
   eksplisit — cukup satu kalimat dari tim gudang untuk memastikan, dan kalau
   ternyata gudang pusat entitas terpisah tinggal tambah satu baris
   (`INSERT INTO warehouse …`).
2. **Puller Accurate per-gudang** — lihat §4. Butuh konfirmasi multi-gudang
   aktif + izin API, lalu bentuk response dibaca dari response sungguhan. Saat
   menulisnya, **jangan lupa filter allowlist** — gudang virtual customer ada di
   Accurate dan tidak boleh ikut.
3. **Memisahkan "barang di customer" dari "data cabang belum lengkap".** Selisih
   positif sekarang menggabung dua sebab. Kalau nanti stok gudang virtual bisa
   ditarik terpisah (tetap tidak ditampilkan, hanya dipakai sebagai pembanding),
   selisih bisa dipertajam jadi sinyal kualitas data yang sesungguhnya.
4. **"Real-time"** dalam deskripsi board belum terpenuhi secara harfiah: angka
   sekarang selamanya dari import terakhir (kolom "Data terakhir masuk"
   menunjukkan kapan). Mirror Accurate sendiri pun batch pull (cron 6×/hari),
   jadi "real-time" penuh perlu pembahasan terpisah — kemungkinan yang dimaksud
   "selalu tampil versi terkini yang dimiliki sistem", bukan streaming.
5. **UI koreksi manual per baris** (`source='manual'`) belum dibangun — kolom
   sudah menerimanya, tapi belum ada formnya. Sengaja: kalau nanti data datang
   otomatis dari Accurate, form koreksi manual justru menciptakan dua sumber
   kebenaran.
6. **`ON DELETE CASCADE` dari `accurate_item` = risiko laten.** Hari ini tak ada
   kode yang menghapus dari mirror (`syncItems` murni upsert, dan tak ada
   `DELETE FROM accurate_item` di repo), jadi belum hidup. Tapi mirror tak punya
   soft-delete, dan memangkas baris basi adalah hal paling wajar yang akan
   ditambahkan orang ke `syncItems` — hari itu data opname manual hilang tanpa
   log. `ON DELETE RESTRICT` akan membuat percobaan itu gagal keras. Dibiarkan
   sekarang agar tidak mengubah perilaku tanpa diminta, tapi ini yang pertama
   perlu ditinjau kalau puller item disentuh.
7. **`accurate_item.no` tidak UNIQUE**, sementara importer join `ai.no = s.sku`.
   Kalau suatu hari ada dua item ber-`no` sama, satu baris CSV akan menulis ke
   dua item. Nol duplikat & nol NULL di mirror saat diperiksa, jadi ini asumsi
   yang belum ditegakkan — bukan bug aktif.
8. **State tab tidak ada di URL**, jadi tab "Per Gudang" tak bisa di-bookmark
   atau di-share; refresh selalu kembali ke "Semua Stok".
