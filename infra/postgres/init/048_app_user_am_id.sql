-- 048 — F127 Sales Analytics: tautkan akun login (app_user) ke roster AM
-- (master_user.am_id) untuk row-level scope "AM lihat data sendiri". Additive,
-- idempoten. Backfill best-effort via kecocokan wa_number ternormalisasi (hanya
-- saat kecocokan TUNGGAL); sisanya diisi manual via menu User Access.

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS am_id text;
CREATE INDEX IF NOT EXISTS app_user_am_id_idx ON app_user (am_id);

COMMENT ON COLUMN app_user.am_id IS 'F127 — link ke master_user.am_id (roster). NULL utk akun non-AM (admin/HoD/office).';

-- Backfill aman: hanya isi baris yang am_id-nya masih NULL DAN wa_number-nya
-- cocok PERSIS satu master_user (hindari salah tautkan bila nomor tak unik).
UPDATE app_user au
SET am_id = mu.am_id
FROM master_user mu
WHERE au.am_id IS NULL
  AND au.wa_number IS NOT NULL AND au.wa_number <> ''
  AND mu.wa_number IS NOT NULL AND mu.wa_number <> ''
  AND regexp_replace(au.wa_number, '[^0-9]', '', 'g') = regexp_replace(mu.wa_number, '[^0-9]', '', 'g')
  AND (
    SELECT count(*) FROM master_user m2
    WHERE m2.wa_number IS NOT NULL AND m2.wa_number <> ''
      AND regexp_replace(m2.wa_number, '[^0-9]', '', 'g') = regexp_replace(au.wa_number, '[^0-9]', '', 'g')
  ) = 1;
