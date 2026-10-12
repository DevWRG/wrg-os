-- 204 — F34: habis_susut hanya untuk aset yang memang disusutkan.
--
-- Sinkron pertama prod (12 Okt, 1.394 aset) memperlihatkan 2 tanah (TNH)
-- bermetode NONDEPREFA dengan residu = nilai perolehan. Rumus 203
-- (book_value <= residu) menandai keduanya "habis disusutkan" — salah: tanah
-- tidak disusutkan sama sekali. Sekarang syaratnya ikut metode, sama seperti
-- susut_per_bulan dan sisa_bulan yang sejak 203 sudah NULL untuk metode lain.
-- Kolom & urutannya tak berubah (CREATE OR REPLACE VIEW mensyaratkan itu),
-- jadi GRANT dari 203 tetap berlaku.

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
  (NOT a.disposed AND a.depreciation_method = 'STRAIGHTLINE'
   AND COALESCE(a.book_value, 0) <= COALESCE(a.residu, 0)) AS habis_susut
FROM accurate_fixed_asset a
LEFT JOIN fixed_asset_override o ON o.accurate_id = a.id;
