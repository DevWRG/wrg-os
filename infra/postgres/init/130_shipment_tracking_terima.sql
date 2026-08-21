-- 078 — SJ→BAST Closed-Loop Tracker (F42, SHIPPING): extend F12
-- `shipment_tracking` dengan 1 state baru "terima" di antara dikirim & bast.
--
-- State machine JADI: draft → dikirim → terima → bast (4 langkah).
-- TTF SENGAJA TIDAK DIPAKAI di sini juga — arahan Direktur eksplisit utk
-- F42 (2026-07-30): "cukup sampai BAST aja, tidak pakai TTF" — konsisten
-- dgn keputusan F12 sebelumnya (bukan cuma khusus F12, ternyata berlaku
-- juga F42). Langkah "faktur titip" & "ttf cair" dari deskripsi board TIDAK
-- diimplementasikan.
--
-- "terima" ditandai MANUAL via web (bukan WA hashtag) — board cuma sebut
-- hashtag #SJ #BAST #TTF, tak ada hashtag utk "terima". Ini DEFAULT
-- ENGINEER (belum eksplisit dikonfirmasi Direktur), lihat
-- docs/features/F42-sj-bast-closed-loop-tracker.md.

ALTER TABLE shipment_tracking DROP CONSTRAINT IF EXISTS shipment_tracking_status_check;
ALTER TABLE shipment_tracking ADD CONSTRAINT shipment_tracking_status_check
  CHECK (status IN ('draft','dikirim','terima','bast'));

ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS terima_at timestamptz;
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS terima_by text; -- sender_name WA / user web, audit bukan FK

COMMENT ON TABLE shipment_tracking IS
  'F12+F42 — Tracking Pengiriman (SHIPPING): status kirim per SJ, state machine draft→dikirim→terima→bast, dipicu WA hashtag #KIRIM/#BAST (terima manual via web). distance_km/eta_days dihitung otomatis dari foto ber-geotag #KIRIM/#BAST (lihat 129_shipment_tracking_geo.sql).';
