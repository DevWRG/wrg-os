-- 071 — Delivery Proof Capture (F93, OPS): extend F12+F42 `shipment_tracking`
-- dengan hashtag WA BARU #BUKTI [SJ_no] — kurir upload foto bukti
-- terima/serah-terima + foto scan tanda tangan customer, SETELAH BAST
-- selesai (audit trail tambahan, BUKAN state baru di state machine —
-- status tetap 'bast', cuma nempel 2 field foto + metadata).
--
-- Kenapa 2 slot foto: deskripsi board sebut "photo + signature scan" (2
-- artefak beda). #BUKTI bisa dikirim lebih dari sekali (foto lalu foto
-- scan tanda tangan terpisah) — slot pertama yang masih kosong yang keisi
-- (lihat apps/api/src/repo/shipment-tracking.ts markBukti()). Kalau kurir
-- cuma kirim 1 foto gabungan (barang+slip ttd kelihatan sekaligus), slot
-- signature_photo_path boleh tetap kosong — bukan error.
--
-- "Auto-attach ke SJ record di Accurate mirror" dari deskripsi board TIDAK
-- diartikan literal (mirror Accurate itu READ-ONLY puller, lihat
-- CLAUDE.md) — attach di sini artinya nempel ke `shipment_tracking` yang
-- sudah link "logical" ke SJ Accurate via sj_number, sama pola F12/F22.

ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS bukti_photo_path     text;
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS signature_photo_path text;
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS bukti_at             timestamptz;
ALTER TABLE shipment_tracking ADD COLUMN IF NOT EXISTS bukti_by             text; -- sender_name WA / user web, audit bukan FK

COMMENT ON TABLE shipment_tracking IS
  'F12+F42+F93 — Tracking Pengiriman (SHIPPING/OPS): status kirim per SJ, state machine draft→dikirim→terima→bast, dipicu WA hashtag #KIRIM/#BAST (terima manual via web). distance_km/eta_days otomatis dari foto geotag #KIRIM/#BAST. #BUKTI (setelah bast) capture foto bukti terima + scan tanda tangan sbg audit trail tambahan.';
