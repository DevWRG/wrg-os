-- 203 — F34 Aset Tetap & Depresiasi (fase 1: cermin Accurate).
--
-- Keputusan user 12 Okt 2026: Accurate tetap SUMBER KEBENARAN register aset
-- tetap dan jurnal depresiasinya (modul Fixed Asset sudah dipakai, 1.394 aset).
-- WRG-OS hanya MENCERMINKAN (read-only, ADR-019: tak pernah menulis transaksi
-- keuangan ke Accurate) lalu menambah lapisan yang Accurate tak punya.
--
-- Bentuk data diambil dari probe prod (scripts/qa/probe-accurate-aset-tetap.mjs,
-- PR #1606), bukan ditebak:
--   - list.do hanya bisa membawa 10 field; bookValue/faType/metode/umur cuma
--     ada di detail.do → syncer = list + detail per aset.
--   - akumulasi penyusutan TIDAK ada sebagai field → turunan (cost − bookValue).
--   - jadwal depresiasi TIDAK disediakan → dihitung (view di bawah).
--   - 1.079 aset bertransDate 2024 — diduga tanggal saldo awal/cut-over, bukan
--     tanggal beli asli (umur ganjil 59/58/19 bulan = sisa umur). Belum
--     dikonfirmasi Accounting, jadi tanggal asli disimpan TERPISAH di override
--     dan boleh kosong.
--   - nomor KSO-n tak punya kunci bersama dengan kso_asset (SN) → tautannya
--     manual lewat override, bukan dicocokkan otomatis.

CREATE TABLE IF NOT EXISTS accurate_fixed_asset (
  id                        bigint PRIMARY KEY,          -- id Accurate
  number                    text NOT NULL,               -- KSO-1167, INK-…, VHC-…
  -- Prefiks huruf nomor = kelompok kerja (KSO alat, INK inventaris, VHC
  -- kendaraan, TNH tanah, GDG gedung). Diturunkan, bukan diketik ulang.
  prefix                    text GENERATED ALWAYS AS (upper(substring(number FROM '^[A-Za-z]+'))) STORED,
  description               text,
  fa_type_id                bigint,
  fa_type_name              text,                        -- ALAT KSO / INVENTARIS KANTOR / KENDARAAN
  quantity                  numeric(18,4),
  quantity_disposed         numeric(18,4),
  disposed                  boolean NOT NULL DEFAULT false,
  intangible                boolean NOT NULL DEFAULT false,
  asset_cost                numeric(18,2),               -- nilai perolehan awal
  current_asset_cost        numeric(18,2),               -- sesudah tambahan/revaluasi
  book_value                numeric(18,2),
  residu                    numeric(18,2),
  depreciation_method       text,                        -- STRAIGHTLINE (semua, per probe)
  depreciation_rate         numeric(9,4),                -- % per tahun
  estimated_life_months     integer,
  current_estimated_life    integer,                     -- bulan, basis periode berjalan
  trans_date                date,                        -- tanggal di Accurate (bisa = cut-over)
  usage_date                date,
  current_start_date        date,
  last_journal_date         date,                        -- jurnal depresiasi terakhir di Accurate
  branch_id                 bigint,
  branch_name               text,
  location_name             text,
  asset_account_id          bigint,
  depreciation_account_id   bigint,
  acm_depreciation_account_id bigint,
  purchase_invoice_id       bigint,                      -- nol terisi di sampel probe
  notes                     text,
  -- Payload detail.do utuh untuk audit. JANGAN dipakai di agregat (detoast
  -- mahal, lihat #1417) — semua yang diagregasi punya kolom sendiri.
  raw                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accurate_fixed_asset_prefix_idx ON accurate_fixed_asset (prefix);
CREATE INDEX IF NOT EXISTS accurate_fixed_asset_type_idx   ON accurate_fixed_asset (fa_type_name);
CREATE INDEX IF NOT EXISTS accurate_fixed_asset_number_trgm ON accurate_fixed_asset USING gin (number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS accurate_fixed_asset_desc_trgm   ON accurate_fixed_asset USING gin (description gin_trgm_ops);

-- Lapisan milik WRG-OS: TIDAK pernah disentuh syncer, jadi koreksi tim Finance
-- bertahan walau cermin ditarik ulang. Tanpa FK ke accurate_fixed_asset —
-- aset yang dihapus di Accurate tak boleh ikut menghapus catatan Finance.
CREATE TABLE IF NOT EXISTS fixed_asset_override (
  accurate_id           bigint PRIMARY KEY,
  tgl_perolehan_asli    date,                            -- NULL = belum diisi
  kso_asset_id          bigint REFERENCES kso_asset(id) ON DELETE SET NULL,
  catatan               text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixed_asset_override_kso_idx ON fixed_asset_override (kso_asset_id) WHERE kso_asset_id IS NOT NULL;

-- Turunan depresiasi garis lurus. Dasar = periode BERJALAN Accurate
-- (current_asset_cost / current_estimated_life / current_start_date) karena
-- itulah yang dijurnal Accurate sesudah revaluasi/tambahan.
--   susut_per_bulan  = (current_asset_cost − residu) / current_estimated_life
--   akumulasi        = current_asset_cost − book_value
--   sisa_bulan       = ceil((book_value − residu) / susut_per_bulan)
-- Metode selain STRAIGHTLINE → kolom turunan NULL (tak menebak rumus).
CREATE OR REPLACE VIEW fixed_asset_v AS
SELECT
  a.id, a.number, a.prefix, a.description, a.fa_type_name, a.disposed, a.intangible,
  a.quantity, a.quantity_disposed,
  a.asset_cost, a.current_asset_cost, a.book_value, a.residu,
  a.depreciation_method, a.depreciation_rate,
  a.estimated_life_months, a.current_estimated_life,
  a.trans_date, a.usage_date, a.current_start_date, a.last_journal_date,
  a.branch_name, a.location_name, a.notes, a.last_synced_at,
  o.tgl_perolehan_asli, o.kso_asset_id, o.catatan AS catatan_finance,
  COALESCE(a.current_asset_cost, 0) - COALESCE(a.book_value, 0) AS akumulasi,
  CASE WHEN a.depreciation_method = 'STRAIGHTLINE' AND COALESCE(a.current_estimated_life, 0) > 0
       THEN round((COALESCE(a.current_asset_cost, 0) - COALESCE(a.residu, 0)) / a.current_estimated_life, 2)
  END AS susut_per_bulan,
  CASE WHEN a.depreciation_method = 'STRAIGHTLINE' AND COALESCE(a.current_estimated_life, 0) > 0
            AND COALESCE(a.current_asset_cost, 0) > COALESCE(a.residu, 0)
       THEN GREATEST(0, ceil(
              (COALESCE(a.book_value, 0) - COALESCE(a.residu, 0))
              / ((COALESCE(a.current_asset_cost, 0) - COALESCE(a.residu, 0)) / a.current_estimated_life)
            ))::int
  END AS sisa_bulan,
  (NOT a.disposed AND COALESCE(a.book_value, 0) <= COALESCE(a.residu, 0)) AS habis_susut
FROM accurate_fixed_asset a
LEFT JOIN fixed_asset_override o ON o.accurate_id = a.id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON accurate_fixed_asset, fixed_asset_override TO wrg_app;
    GRANT SELECT ON fixed_asset_v TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON accurate_fixed_asset, fixed_asset_override, fixed_asset_v TO wrg_readonly;
  END IF;
END $$;
