-- 082 — F37 Cross-Branch Stock Visibility (PURCHASING): stok per gudang +
-- korelasi ke stok total Accurate.
--
-- KONTEKS "F2" (deskripsi board: "Extends F2 SQC ke multi-warehouse"):
-- F2 bukan fitur yang belum ada — itu FUNGSI CEK STOK yang sudah hidup di menu
-- `/inventory` (baca `accurate_item.quantity`/`available`, satu angka agregat
-- per SKU untuk seluruh perusahaan). Klarifikasi pemilik fitur: "F2 itu hanya
-- fungsi untuk cek stok, dan dikorelasikan dg stok yg ada di cabang. Jd
-- sebenernya itu satu menu, tp 2 fungsi." Karena itu F37 TIDAK membuat menu
-- baru — `/inventory` jadi 2 tab: "Semua Stok" (F2, tetap) + "Per Gudang" (F37).
--
-- KENAPA TABEL BARU, bukan kolom di `accurate_item`:
-- `accurate_item` PK-nya `id` TUNGGAL, satu baris per SKU — secara struktural
-- tak bisa menyimpan breakdown per gudang. Puller-nya juga memakai field
-- whitelist (`fields=id,no,name,itemType,unitPrice,quantity,availableToSell,
-- unit1` di accurateSync.ts), jadi `raw` pun tak memuat data gudang.
--
-- SUMBER DATA — sengaja PLUGGABLE lewat kolom `source`:
--   'import'   diisi dari Excel/CSV tim gudang via scripts/db/import_stock_branch.py
--   'manual'   koreksi per baris dari UI (belum dibangun; slot disediakan)
--   'accurate' NANTI, kalau puller per-gudang dibangun
-- Skema OpenAPI Accurate (account.accurate.id/open-api/json.do) memang punya
-- `/api/warehouse`, `/api/stock-mutation-history-view`, `/api/stock-opname-*`,
-- dan `/api/item-transfer` — jadi jalur otomatis ARSITEKTURNYA mungkin. TAPI
-- dokumen itu terpotong sebelum bagian field, dan 2 hal belum terverifikasi:
-- (a) apakah langganan Accurate WRG mengaktifkan multi-gudang & 11 gudang ini
-- benar terdaftar di sana, (b) apakah user API kita punya izin ke endpoint itu.
-- Keduanya butuh kredensial prod. Puller SENGAJA belum ditulis — menulisnya
-- sekarang berarti menebak bentuk response. Kolom `source` bikin peralihan
-- nanti tidak butuh migrasi lagi.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- ── Master gudang = ALLOWLIST, bukan sekadar label ──────────────────────────
-- Data referensi kecil & jarang berubah → SEED SQL, bukan halaman CRUD
-- (konvensi yang sudah dipakai F50 `vehicle`).
--
-- ⚠️ ATURAN YANG WAJIB DIPEGANG SIAPA PUN YANG MENULIS PULLER ACCURATE NANTI:
-- WRG juga punya **gudang VIRTUAL yang berada di customer** (arahan Direktur
-- 2026-07-31: "kita ada jg gudang virtual yg ada di customer. Ini ndak masuk.
-- Maksudnya selain gudang cabang kita, ndak usah di tampilkan stoknya").
-- Gudang semacam itu ADA di Accurate dan akan ikut terbawa kalau puller
-- menarik seluruh daftar gudang apa adanya.
--
-- Karena itu tabel ini berperan sebagai ALLOWLIST: hanya kode yang terdaftar di
-- sini yang boleh masuk `item_stock_branch` dan tampil di UI. Puller nanti WAJIB
-- memfilter (`WHERE kode IN (SELECT kode FROM warehouse)`) — jangan meng-INSERT
-- gudang baru secara otomatis dari respons Accurate, karena itu tepat cara
-- stok milik customer bocor ke layar AM. Importer CSV sudah menegakkan aturan
-- ini (kolom gudang tak dikenal → ditolak, bukan diabaikan), dan query baca
-- menambahkan gerbang `jenis = 'cabang'` supaya aturannya struktural.
CREATE TABLE IF NOT EXISTS warehouse (
  -- Kode pendek dipakai sebagai kolom di matriks UI dan sebagai header kolom
  -- CSV importer — jadi jangan di-rename sembarangan (ON UPDATE CASCADE
  -- menjaga FK, tapi file CSV tim gudang ikut harus diubah).
  kode    text PRIMARY KEY,
  nama    text NOT NULL,
  -- Label cabang/wilayah, selaras nilai bebas `master_user.cabang`. Bukan FK:
  -- tak ada tabel cabang kanonik di sistem ini (accurate_branch praktis kosong,
  -- kolom `name` tak pernah diisi puller).
  cabang  text,
  urutan  int     NOT NULL DEFAULT 0,   -- urutan kolom di matriks
  aktif   boolean NOT NULL DEFAULT true,

  -- Jenis gudang, DIPAKAI SEBAGAI GERBANG oleh query baca — bukan label.
  --
  -- Tanpa kolom ini, aturan Direktur ("selain gudang cabang kita, ndak usah di
  -- tampilkan stoknya") cuma dijaga oleh isi tabel: puller masa depan yang
  -- melakukan `INSERT … ON CONFLICT DO UPDATE` ke `warehouse` — bentuk paling
  -- alami untuk sebuah mirror — membuat gudang customer terlihat dalam satu
  -- langkah, dan penghitung agregat menyerapnya ke Σ Cabang sebelum ada yang
  -- sadar ada kolom baru. Dengan kolom ini, baris yang masuk tanpa jenis
  -- eksplisit TIDAK ikut terbaca.
  --
  -- TANPA DEFAULT, dan itu disengaja: `DEFAULT 'cabang'` akan membuat insert
  -- lalai justru TERLIHAT — tepat kebalikan dari tujuannya. `DEFAULT 'customer'`
  -- juga tidak dipilih karena menyembunyikan gudang cabang baru secara senyap.
  -- Wajib eksplisit = penulisnya dipaksa memutuskan, dan puller yang lupa gagal
  -- keras (NOT NULL violation) bukannya membocorkan data.
  jenis   text    NOT NULL CHECK (jenis IN ('cabang', 'customer')),

  catatan text
);

-- ── Stok per item per gudang ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_stock_branch (
  -- FK ke mirror item: SKU yang tak dikenal mirror ditolak (importer
  -- melaporkannya) — lebih baik daripada menyimpan stok untuk SKU hantu.
  item_id        bigint NOT NULL REFERENCES accurate_item (id) ON DELETE CASCADE,
  warehouse_kode text   NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE,

  -- CHECK-nya di DB, bukan cuma di importer: `source='manual'` dan SQL langsung
  -- juga harus tertahan. Stok negatif tak punya arti di sini, dan kalau lolos ia
  -- membuat Σ Cabang & selisih ikut salah tanpa gejala.
  quantity  numeric(16,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),

  -- Asal angka. WAJIB diisi jujur: UI menampilkannya supaya pembaca tahu ini
  -- hasil opname manual atau tarikan sistem. Jangan tulis 'accurate' untuk data
  -- yang sebenarnya di-import dari Excel.
  source    text NOT NULL DEFAULT 'import' CHECK (source IN ('manual','import','accurate')),

  -- Kapan angka ini terakhir diperbarui — dipakai UI menandai data basi.
  updated_at timestamptz NOT NULL DEFAULT now(),
  catatan    text,

  PRIMARY KEY (item_id, warehouse_kode)
);

-- Matriks difilter/di-agregat per gudang → index sendiri (PK sudah menutup
-- akses per item).
CREATE INDEX IF NOT EXISTS item_stock_branch_wh_idx ON item_stock_branch (warehouse_kode);

-- Jalur untuk instalasi yang sudah menjalankan draft 082 sebelum kolom `jenis`
-- ada. No-op pada instalasi baru (CREATE TABLE di atas sudah memuatnya).
ALTER TABLE warehouse ADD COLUMN IF NOT EXISTS jenis text;
UPDATE warehouse SET jenis = 'cabang' WHERE jenis IS NULL;
ALTER TABLE warehouse ALTER COLUMN jenis SET NOT NULL;
ALTER TABLE warehouse DROP CONSTRAINT IF EXISTS warehouse_jenis_check;
ALTER TABLE warehouse ADD CONSTRAINT warehouse_jenis_check CHECK (jenis IN ('cabang', 'customer'));

COMMENT ON TABLE warehouse IS
  'F37 — master 11 gudang CABANG WRG (arahan Direktur 2026-07-31). Seed SQL, bukan CRUD. Berperan sebagai ALLOWLIST: kolom jenis memisahkan gudang cabang dari gudang virtual di customer, dan query baca hanya mengambil jenis=cabang.';
COMMENT ON TABLE item_stock_branch IS
  'F37 — stok per item per gudang. Dikorelasikan dgn accurate_item.quantity (total perusahaan) di menu /inventory tab "Per Gudang": selisih total vs jumlah cabang menandakan data gudang belum lengkap/basi. Kolom source menandai asal angka (import/manual/accurate).';

-- ── Seed 12 gudang cabang ───────────────────────────────────────────────────
-- Sumber: arahan Direktur 2026-07-31 (bukan deskripsi board). Board menyebut
-- "Pusat/Kemangi/Surabaya/Madiun/Jember" — itu daftar LAMA/tidak lengkap dan
-- SUDAH DIGANTI oleh daftar di bawah:
--   "Kita ada gudang surabaya 1, lamongan, tuban, jember, kediri, madiun,
--    madura, jakarta, jogja&solo, ntb, ntt"
--
-- Catatan penting soal "surabaya 1": angka 1 itu JUMLAH, bukan nomor urut —
-- klarifikasi Direktur: "konteks surabaya 1 itu maksudnya di surabaya ada 1
-- gudang". Jadi TIDAK ada "Surabaya 2", dan namanya cukup "Gudang Surabaya".
-- (Seed HR menyebut station "SBY 2" beberapa kali — itu station kirim-tagih,
-- bukan gudang.)
--
-- Koreksi lanjutan: "jogja&solo" sempat disebut sbg SATU gudang (`JOGJASOLO`)
-- di draft awal migrasi ini, sebelum branch F37 pernah di-merge/dipakai di mana
-- pun — Direktur lalu minta dipisah jadi 2 gudang berbeda. Krn kode itu tak
-- pernah benar-benar dirilis (tak ada data stok yg mereferensikannya), koreksi
-- ini langsung mengganti baris INSERT-nya, bukan deaktivasi kode terpisah spt
-- PUSAT/KEMANGI/SBY1 di bawah (yang memang sempat "hidup" lebih dulu).
--
-- `kode` dipakai sebagai header kolom CSV importer dan header kolom di UI, jadi
-- dibuat pendek & stabil. Mengganti kode berarti file CSV tim gudang ikut harus
-- diubah — hindari.
INSERT INTO warehouse (kode, nama, cabang, urutan, jenis, catatan) VALUES
  ('SBY',       'Gudang Surabaya',      'Surabaya',    10, 'cabang', 'Satu-satunya gudang di Surabaya'),
  ('LAMONGAN',  'Gudang Lamongan',      'Lamongan',    20, 'cabang', NULL),
  ('TUBAN',     'Gudang Tuban',         'Tuban',       30, 'cabang', NULL),
  ('JEMBER',    'Gudang Jember',        'Jember',      40, 'cabang', NULL),
  ('KEDIRI',    'Gudang Kediri',        'Kediri',      50, 'cabang', NULL),
  ('MADIUN',    'Gudang Madiun',        'Madiun',      60, 'cabang', NULL),
  ('MADURA',    'Gudang Madura',        'Madura',      70, 'cabang', NULL),
  ('JAKARTA',   'Gudang Jakarta',       'Jakarta',     80, 'cabang', NULL),
  ('JOGJA',     'Gudang Jogja',         'Jogja',       90, 'cabang', NULL),
  ('SOLO',      'Gudang Solo',          'Solo',        91, 'cabang', NULL),
  ('NTB',       'Gudang NTB',           'NTB',        100, 'cabang', NULL),
  ('NTT',       'Gudang NTT',           'NTT',        110, 'cabang', NULL)
ON CONFLICT (kode) DO UPDATE SET
  nama = EXCLUDED.nama, cabang = EXCLUDED.cabang, urutan = EXCLUDED.urutan;

-- Kode dari draft SEBELUM arahan Direktur, DAN kode yang sudah dikoreksi lagi
-- setelahnya. DINONAKTIFKAN, bukan di-DELETE: kalau ada instalasi yang sudah
-- sempat mengisi stok memakai kode itu, DELETE akan menghapus datanya lewat
-- ON DELETE CASCADE. aktif=false sudah cukup — importer hanya menerima gudang
-- aktif dan UI menandainya "(nonaktif)".
--   PUSAT/KEMANGI → dari deskripsi board yang usang
--   SBY1          → dari draft yang salah membaca "surabaya 1" sbg nomor urut
UPDATE warehouse SET aktif = false,
       catatan = 'Kode draft sebelum arahan Direktur 2026-07-31; tidak dipakai lagi'
 WHERE kode IN ('PUSAT', 'KEMANGI', 'SBY1');

-- ── Menu RBAC ───────────────────────────────────────────────────────────────
-- Awalnya F37 hidup sebagai TAB di menu `/inventory` (key 'inventory' bersama).
-- Setelah arahan Direktur soal domain grouping (sidebar dikelompokkan per
-- domain, bukan campur di "Operations"), F37 pindah jadi route sendiri
-- `/stok-gudang` (section Purchasing) dgn key RBAC sendiri (`stok-gudang`,
-- auto dari URL) — lihat apps/web/src/lib/nav.ts. Perlu digrant terpisah dari
-- key 'inventory' di Akses Grup.
