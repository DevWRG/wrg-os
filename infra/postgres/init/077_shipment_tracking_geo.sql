-- 077 — Tracking Pengiriman: capture geo dari foto ber-geotag WA (F12,
-- REVISI arahan Direktur 2026-07-30): jarak (km) TIDAK LAGI diinput manual
-- di awal. Sebagai gantinya:
--   #KIRIM + foto ber-geotag → capture titik AWAL (kirim_lat/kirim_lon).
--   #BAST  + foto ber-geotag → capture titik CUSTOMER (bast_lat/bast_lon).
-- Begitu KEDUANYA ada, distance_km + eta_days dihitung OTOMATIS (haversine +
-- durasi aktual kirim_at→bast_at) — dipakai analitik "kesesuaian" jarak vs
-- waktu tempuh, BUKAN estimasi customer di awal lagi (lihat
-- apps/api/src/repo/shipment-tracking.ts, docs/features/F12-*.md).
--
-- Ini menjawab 2 pertanyaan terbuka sebelumnya sekaligus: titik A (cabang)
-- TAK PERLU tabel referensi statis lagi (dinamis dari foto #KIRIM tiap
-- shipment), titik B (customer) dari foto #BAST (sudah diduga sebelumnya).

ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS kirim_lat numeric(9,6);
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS kirim_lon numeric(9,6);
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS bast_lat  numeric(9,6);
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS bast_lon  numeric(9,6);

-- eta_date dibuang — redundan dgn bast_at (yang sekarang jadi "tanggal
-- sampai aktual"), tak ada lagi konsep tanggal estimasi-sebelum-kirim.
ALTER TABLE shipment_tracking DROP COLUMN IF EXISTS eta_date;

COMMENT ON COLUMN shipment_tracking.distance_km IS
  'Dihitung OTOMATIS (haversine kirim_lat/lon → bast_lat/lon) setelah BAST — BUKAN input manual lagi (revisi 2026-07-30).';
COMMENT ON COLUMN shipment_tracking.eta_days IS
  'Setelah BAST: durasi AKTUAL kirim_at→bast_at (hari) — dipakai bandingkan kesesuaian vs distance_km, bukan estimasi sebelum kirim lagi.';
