-- 076 — F1-SPT: konsolidasi pipeline 8 → 7 tahap (definisi SPT baru dari direksi).
--   First Contact → Prospecting  (sudah kunjungan pertama, ada interest / mau diajak bicara)
--   Offering      → Quotation    (proposal/quotation tertulis — offering letter ikut di sini)
--   + tahap BARU 'Closing'       (menunggu tanda tangan / PO, semua isu resolved)
-- Nilai enum 'Closing-Won'/'Closing-Lost' SENGAJA tidak di-rename: dipakai literal di
-- banyak query report (stats/coaching/product/anomaly/leaderboard/winloss) dan gate
-- approval Lost. UI board menampilkannya sebagai "Won"/"Lost" (label tampilan).
-- PostgreSQL tak punya DROP VALUE untuk enum → 'First Contact'/'Offering' ditinggal
-- sebagai nilai mati; sumber kebenaran tahap yang valid = DEAL_STAGES (apps/api).
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) atur transaksi.

-- 1) Tahap baru 'Closing', diselipkan sebelum 'Closing-Won'. ADD VALUE boleh di dalam
--    blok transaksi (PG12+) SELAMA nilai barunya tidak dipakai di transaksi yang sama —
--    migrasi ini memang tidak pernah menulis 'Closing' ke row mana pun.
ALTER TYPE deal_stage ADD VALUE IF NOT EXISTS 'Closing' BEFORE 'Closing-Won';

-- 2) Pindahkan deal dari tahap yang dilebur. updated_at & stage_entered_at TIDAK
--    disentuh: ini reklasifikasi, bukan aktivitas sales (jaga urutan board & days_in_stage).
UPDATE deal SET stage = 'Prospecting' WHERE stage = 'First Contact';
UPDATE deal SET stage = 'Quotation'   WHERE stage = 'Offering';

-- 3) Re-derive snapshot kategori/probabilitas/forecast agar selaras STAGE_META baru
--    (apps/api/src/repo/deal.ts + STAGE_DERIVE importer — jaga tetap sinkron).
--    Kategori prospek per keputusan direksi: Cold s/d Quotation, Warm Negotiation,
--    Hot mulai Closing.
UPDATE deal d SET
  prospect_category = m.prospect,
  probability       = m.prob,
  forecast_category = m.forecast
FROM (VALUES
  ('Prospecting',  'Cold', 0.10, 'D - Omit'),
  ('Presentation', 'Cold', 0.30, 'C - Pipeline'),
  ('Quotation',    'Cold', 0.50, 'C - Pipeline'),
  ('Negotiation',  'Warm', 0.70, 'B - Best Case'),
  ('Closing-Won',  'Hot',  1.00, 'Won'),
  ('Closing-Lost', NULL,   0.00, 'Lost')
) AS m(stage, prospect, prob, forecast)
WHERE d.stage::text = m.stage
  AND (d.prospect_category IS DISTINCT FROM m.prospect
    OR d.probability       IS DISTINCT FROM m.prob
    OR d.forecast_category IS DISTINCT FROM m.forecast);
