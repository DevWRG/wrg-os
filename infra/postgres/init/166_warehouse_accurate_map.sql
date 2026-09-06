-- 166 — F37: pemetaan gudang Accurate → gudang kita, sebagai ALLOWLIST BER-ID.
--
-- Melengkapi 082, yang menyiapkan `item_stock_branch.source='accurate'` tapi
-- sengaja tidak menulis puller-nya karena dua hal belum terverifikasi. Keduanya
-- sudah dijawab probe di prod (#836, 2026-09-05 & 2026-09-06):
--   · modul multi-gudang AKTIF dan user API BERIZIN — warehouse/list.do jalan,
--     109 gudang terbaca;
--   · saldo per gudang HANYA tersedia lewat item/detail.do (per SKU) —
--     `detailWarehouseData` array berisi warehouseName/balance/unitNQuantity.
--     item/list.do dgn field/filter gudang jalan tapi mengabaikannya DIAM-DIAM
--     (kunci baris tetap {id,no,name,quantity}), dan seluruh varian endpoint
--     mutasi/opname membalas 404.
-- Konsekuensinya sapuan penuh = ±5.900 panggilan → real-time tak layak,
-- sinkron HARIAN yang layak. Itu sebabnya #836 di-re-scope, bukan ditutup.
--
-- ── KENAPA TABEL, BUKAN KOLOM `warehouse.accurate_warehouse_id` ──
-- Kedua probe menyarankan bentuk KOLOM, dan itu benar sampai keputusan
-- Surabaya turun. Accurate punya TIGA gudang Surabaya (GUDANG SURABAYA,
-- SURABAYA 1, SURABAYA2) yang di sisi kita cuma satu kode `SBY`. Satu kolom
-- tak bisa menampung tiga id; memaksakannya berarti dua gudang Surabaya
-- diam-diam tak pernah ikut terbaca. Jadi pemetaannya BANYAK→SATU, dan
-- tabel ini yang jadi bentuknya.
--
-- ── TABEL INI ADALAH GERBANGNYA, BUKAN SEKADAR KAMUS ──
-- 96 dari 109 gudang di Accurate adalah gudang VIRTUAL milik customer
-- (DINKES/PKM/LABKESDA) — arahan Direktur 2026-07-31: "selain gudang cabang
-- kita, ndak usah di tampilkan stoknya". Puller WAJIB hanya menerima id yang
-- terdaftar di sini. Dua heuristik yang sempat terlihat masuk akal TERBUKTI
-- BOCOR, jadi jangan dipakai lagi:
--   · `suspended` — bernilai false untuk SELURUH 109 baris, termasuk
--     TEMPORARY dan PUSAT NOT AVAILABLE. Nol sinyal.
--   · prefix nama 'GUDANG' — ikut menangkap SPAREPART KSO, TEMPORARY, dan dua
--     PUSAT. 13 baris berawalan GUDANG, hanya 8 di antaranya operasional.
-- Bukti paling terang: baris pertama `detailWarehouseData` di prod adalah
-- "DINKES KAB. BUTON UTARA".
--
-- Additive + idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.

CREATE TABLE IF NOT EXISTS warehouse_accurate (
  -- PK = id gudang di Accurate. Menjadikannya PK berarti satu gudang Accurate
  -- tak mungkin terpetakan ke dua kode kita (yang akan menggandakan stoknya
  -- saat dijumlahkan), sementara arah sebaliknya (banyak→satu) tetap boleh.
  accurate_warehouse_id bigint PRIMARY KEY,

  warehouse_kode text NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE ON DELETE CASCADE,

  -- Nama sebagaimana terbaca di Accurate saat pemetaan dibuat. SNAPSHOT untuk
  -- jejak audit — BUKAN untuk dicocokkan saat runtime. Kalau nama di Accurate
  -- berubah, pemetaannya tetap sah karena yang mengikat adalah id.
  accurate_name text,

  catatan    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warehouse_accurate_kode_idx ON warehouse_accurate (warehouse_kode);

-- ── Seed: 8 id operasional → 7 kode kita ────────────────────────────────────
-- Diambil dari warehouse/list.do di prod 2026-09-06. Tiga keputusan pemilik
-- fitur (2026-09-06) yang dikodekan di sini:
--   1. allowlist pakai ID, bukan nama/flag  → bentuk tabel ini
--   2. tiga gudang Surabaya DIJUMLAHKAN     → 100/2250/200 semuanya → 'SBY'
--   3. lima cabang tanpa padanan DI-SKIP    → LAMONGAN, TUBAN, JOGJA, SOLO, NTT
--      sengaja TIDAK punya baris di sini. Akibatnya puller tak pernah menyentuh
--      stok mereka, dan angka CSV (source='import') tetap berlaku apa adanya.
--      Itu perilaku yang diinginkan, bukan kelalaian — UI sudah menampilkan
--      kolom `sumber` per item sehingga campurannya terbaca jujur.
--
-- TIDAK dipetakan dengan sengaja (ada di Accurate, bukan gudang cabang):
--   50   GUDANG PUSAT QTN
--   101  GUDANG PUSAT NOT AVAILABLE
--   150  GUDANG SPAREPART KSO
--   550  GUDANG TEMPORARY
INSERT INTO warehouse_accurate (accurate_warehouse_id, warehouse_kode, accurate_name, catatan) VALUES
  ( 100, 'SBY',     'GUDANG SURABAYA',   'Surabaya 1 dari 3 — dijumlahkan ke SBY (keputusan 2026-09-06)'),
  (2250, 'SBY',     'GUDANG SURABAYA 1', 'Surabaya 2 dari 3 — dijumlahkan ke SBY'),
  ( 200, 'SBY',     'GUDANG SURABAYA2',  'Surabaya 3 dari 3 — dijumlahkan ke SBY'),
  ( 201, 'KEDIRI',  'GUDANG KEDIRI',     NULL),
  ( 250, 'MADURA',  'GUDANG MADURA',     NULL),
  ( 300, 'MADIUN',  'GUDANG MADIUN',     NULL),
  ( 450, 'JAKARTA', 'GUDANG JAKARTA',    NULL),
  ( 500, 'JEMBER',  'GUDANG JEMBER',     NULL),
  -- Satu-satunya baris yang berdiri di atas kecocokan NAMA, bukan konfirmasi
  -- orang: di Accurate namanya MATARAM (ibu kota NTB), di kita kodenya NTB.
  -- Tak ada padanan lain yang masuk akal, tapi kalau ternyata keliru, stok NTB
  -- akan terisi angka gudang yang salah — dan itu tak akan tampak sebagai error.
  -- Hapus baris ini kalau ragu; NTB lalu jatuh ke perilaku "skip" seperti lima
  -- cabang lainnya.
  ( 600, 'NTB',     'GUDANG MATARAM',    'Kecocokan nama (Mataram = ibu kota NTB), BELUM dikonfirmasi orang')
ON CONFLICT (accurate_warehouse_id) DO UPDATE SET
  warehouse_kode = EXCLUDED.warehouse_kode,
  accurate_name  = EXCLUDED.accurate_name,
  catatan        = EXCLUDED.catatan;

-- ── Penanda progres sapuan per SKU ──────────────────────────────────────────
-- Sapuan penuh ±5.900 panggilan tak boleh dikerjakan sekali jalan tanpa jejak:
-- kalau proses mati di tengah, siklus berikutnya harus melanjutkan, bukan
-- mengulang dari awal. Pola sama dengan `items_synced_at` di 081 (SO/DO).
-- NULL = belum pernah ditarik → antre paling depan.
ALTER TABLE accurate_item ADD COLUMN IF NOT EXISTS stock_synced_at timestamptz;

-- Partial index: yang dicari selalu "yang belum/paling lama ditarik".
CREATE INDEX IF NOT EXISTS accurate_item_stock_pending_idx
  ON accurate_item (stock_synced_at NULLS FIRST);
