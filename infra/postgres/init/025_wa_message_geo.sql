-- 025_wa_message_geo.sql — simpan media_path + hasil OCR geotag di wa_message.
-- Diisi oleh wa-bridge (host) saat pesan media image masuk (OCR via
-- check_photo_geotag.py). Dipakai Fase 3 (foto-followup pairing → activity_log/visit).
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS media_path  TEXT;
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS geo_lat     NUMERIC(9,6);
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS geo_lon     NUMERIC(9,6);
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS geo_ts      TEXT;
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS geo_address TEXT;
