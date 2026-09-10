-- 083 — F38 ED Watch & Near-Expiry Alert (PURCHASING): stok per BATCH + tanggal
-- kedaluwarsa (ED), plus penanda alert 90/60/30 hari.
--
-- Lanjutan F37 (migrasi 082). F37 melacak stok per item per GUDANG; F38 menambah
-- dimensi ketiga — BATCH — karena ED itu milik batch, bukan milik item. Satu SKU
-- bisa punya beberapa batch dengan ED berbeda di gudang yang sama.
--
-- KENAPA TABEL BARU, bukan kolom di `item_stock_branch`:
-- PK `item_stock_branch` adalah (item_id, warehouse_kode) — satu baris per item
-- per gudang. Menambah batch berarti mengubah PK-nya, dan itu memecah F37 yang
-- sudah di-PR. Tabel ini PK-nya (item_id, warehouse_kode, batch_no).
--
-- HUBUNGAN DENGAN `item_stock_branch` — sengaja TIDAK dipaksa saling menurunkan:
-- cakupan keduanya akan berbeda. Tidak semua SKU dilacak per batch (barang
-- non-kedaluwarsa seperti sparepart tak punya ED), sementara opname agregat
-- per gudang mencakup semuanya. Kalau `item_stock_branch.quantity` dipaksa jadi
-- SUM(batch), SKU tanpa batch jadi nol — salah. Kalau sebaliknya, angka batch
-- yang lebih detail malah tertimpa agregat.
-- Jadi keduanya berdiri sendiri dan DIKORELASIKAN (sama pola F37 vs total
-- Accurate): UI menampilkan selisih agregat-vs-batch sebagai penanda cakupan,
-- bukan sebagai error.
--
-- SUMBER DATA: sama seperti F37 — importer CSV dari tim gudang
-- (scripts/db/import_stock_batch.py). Data ED memang masih manual; seed HR
-- (053_seed_employee_spine.sql) merekam pengakuan staf gudang sendiri: "dokumen
-- SP/SJ (manual lot-ED)", "Akurasi stok & lot-ED", KPI "Barang expired → 0".
-- Owner fitur di board (Yugi = Admin Gudang/PJ Barang, Denys = Staf Inventory,
-- Pita = Leader Supply Chain) persis orang yang sekarang memegang catatan itu.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS item_stock_batch (
  item_id        bigint NOT NULL REFERENCES accurate_item (id) ON DELETE CASCADE,

  -- FK ke master gudang F37 → otomatis mewarisi gerbang allowlist: hanya kode
  -- yang terdaftar bisa masuk. Query baca menambahkan `jenis = 'cabang'` supaya
  -- batch di gudang VIRTUAL DI CUSTOMER tidak pernah ikut ter-alert (arahan
  -- Direktur 2026-07-31: "selain gudang cabang kita, ndak usah di tampilkan").
  warehouse_kode text   NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE,

  -- Nomor batch/lot apa adanya dari fisik barang. TEXT bebas: formatnya berbeda
  -- per prinsipal dan tak ada master batch di sistem mana pun.
  batch_no       text   NOT NULL,

  -- Tanggal kedaluwarsa. NULLABLE dan itu disengaja: barang non-kedaluwarsa
  -- (sparepart, alat) tetap boleh dicatat per batch untuk keperluan telusur,
  -- dan baris ber-ED NULL TIDAK ikut dihitung alert — bukan dianggap "sudah
  -- lewat". Query alert selalu menyertakan `ed_date IS NOT NULL`.
  ed_date        date,

  quantity  numeric(16,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),

  source    text NOT NULL DEFAULT 'import' CHECK (source IN ('manual','import','accurate')),

  -- ── Penanda alert, anti-spam per TIER ─────────────────────────────────────
  -- Menyimpan TIER TERKECIL yang sudah pernah diberitahukan (90 / 60 / 30), atau
  -- NULL kalau belum pernah. Alert dikirim hanya kalau tier saat ini LEBIH KECIL
  -- dari yang tercatat — jadi tiap ambang berbunyi sekali, dan tidak ada
  -- pengulangan harian selama 30 hari.
  --
  -- Angka tier, bukan boolean, supaya lintas ambang tetap terdeteksi: kalau cron
  -- mati seminggu dan barang melompat dari 65 hari ke 58 hari, tier 60 tetap
  -- berbunyi (60 < NULL/90). Boolean per-baris akan kehilangan itu.
  -- Termasuk 0 = SUDAH LEWAT ED. Tanpa tier itu, batch yang siklus alert-nya
  -- normal (90→60→30) tak akan pernah diperingatkan saat benar-benar
  -- kedaluwarsa — tier-nya tetap 30 dan syarat "30 < 30" false. Padahal di titik
  -- itulah sarannya berubah jadi "retur", satu-satunya yang butuh tindakan
  -- segera dan yang dibutuhkan KPI gudang "Barang expired → 0".
  alert_tier_terkirim int CHECK (alert_tier_terkirim IN (90, 60, 30, 0)),
  alert_terkirim_at   timestamptz,

  updated_at timestamptz NOT NULL DEFAULT now(),
  catatan    text,

  PRIMARY KEY (item_id, warehouse_kode, batch_no)
);

-- Cron memindai `WHERE ed_date IS NOT NULL AND ed_date <= current_date + 90`
-- lalu mengelompokkan; index by ed_date yang menutup itu. Partial index: baris
-- ber-ED NULL tak pernah discan alert, jadi tak perlu ikut di index.
CREATE INDEX IF NOT EXISTS item_stock_batch_ed_idx
  ON item_stock_batch (ed_date) WHERE ed_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS item_stock_batch_wh_idx ON item_stock_batch (warehouse_kode);

-- Jalur untuk instalasi yang sudah menjalankan draft 083 dengan CHECK lama.
ALTER TABLE item_stock_batch DROP CONSTRAINT IF EXISTS item_stock_batch_alert_tier_terkirim_check;
ALTER TABLE item_stock_batch ADD CONSTRAINT item_stock_batch_alert_tier_terkirim_check
  CHECK (alert_tier_terkirim IN (90, 60, 30, 0));

COMMENT ON TABLE item_stock_batch IS
  'F38 — stok per item per gudang per BATCH + tanggal ED. Sumber alert 90/60/30 hari (cron ed-watch). ed_date NULL = barang non-kedaluwarsa, tidak ikut alert. alert_tier_terkirim menyimpan tier terkecil yang sudah diberitahukan (anti-spam per ambang). Berdiri sendiri dari item_stock_branch (F37) — cakupannya beda, dikorelasikan bukan diturunkan.';

-- Tab baru di menu /inventory yang sudah ada (F2 = Semua Stok, F37 = Per Gudang,
-- F38 = ED & Kedaluwarsa). TIDAK menambah entri `feature`: tab bukan route, jadi
-- key baru akan jadi centang yang tak berfungsi di matriks Akses Grup — pola
-- yang sudah dihindari di Price Book dan di F37.
