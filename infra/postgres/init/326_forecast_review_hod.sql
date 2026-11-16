-- 326 — F19 Forecast: review satu tahap oleh HoD Sales wilayah, lepas dari F11.
--
-- Keputusan product owner 16 Nov 2026: dokumen forecast cabang yang diajukan
-- TIDAK lagi masuk approval berjenjang F11 (approval_request) — F11 hanya ada
-- di dev dan tidak akan dibawa ke main, sedangkan F19 harus bisa dibawa ke
-- main. Gantinya satu review di dashboard oleh HoD Sales wilayah gudang
-- (East/West); Direktur, admin, dan superuser boleh memutus sebagai cadangan.
-- Tanpa notifikasi WA. Persetujuan uang tetap di approval PO (F35).
--
-- (a) FK approval_request_id dilepas (kolom tetap, nullable, jadi jejak
--     dokumen lama). Nama constraint TIDAK di-hardcode — dicari dari
--     pg_constraint (conrelid tabel F19, confrelid approval_request).
-- (b) Kolom review di forecast_dokumen.
-- (c) Backfill dokumen lama dari approval_request HANYA bila tabel itu ada
--     (dev). Di main tabelnya tidak ada → dilewati; SQL dinamis (EXECUTE)
--     supaya berkas ini tetap lolos parse/jalan di main.
-- (d) Grant ikut pola migrasi lain.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- (a) Lepas FK ke approval_request (bila ada) ─────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('approval_request') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tabel
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = to_regclass('approval_request')
      AND c.conrelid IN (to_regclass('forecast_dokumen'), to_regclass('forecast_suggestion'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabel, r.conname);
  END LOOP;
END $$;

-- (b) Kolom review ────────────────────────────────────────────────────────
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS review_status text;
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS review_hod_key text;
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS reviewed_by_user_id text;
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE forecast_dokumen ADD COLUMN IF NOT EXISTS review_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecast_dokumen_review_status_check') THEN
    ALTER TABLE forecast_dokumen ADD CONSTRAINT forecast_dokumen_review_status_check
      CHECK (review_status IS NULL OR review_status IN ('menunggu', 'disetujui', 'ditolak'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS forecast_dokumen_review_idx ON forecast_dokumen (review_status) WHERE review_status IS NOT NULL;

COMMENT ON COLUMN forecast_dokumen.review_status IS
  'F19 — review HoD Sales wilayah: menunggu / disetujui / ditolak. NULL = belum pernah diajukan. Ditolak → dokumen kembali draft (catatan tetap di review_note).';
COMMENT ON COLUMN forecast_dokumen.review_hod_key IS
  'F19 — hod_key HoD Sales wilayah gudang saat diajukan (penentu siapa yang boleh review; Direktur/admin/superuser cadangan).';
COMMENT ON COLUMN forecast_dokumen.review_note IS
  'F19 — catatan keputusan review (wajib saat ditolak).';

-- (c) Backfill dari approval_request (hanya bila ada) ─────────────────────
-- Hanya dokumen yang sudah diajukan (punya approval_request_id) dan belum
-- punya review_status — jalan kedua kali tak mengubah apa pun.
-- approved → disetujui, rejected/canceled → ditolak (dokumen tetap
-- 'submitted' agar bisa Ditutup seperti dulu), pending → menunggu.
-- Pemutus & catatan diambil dari tahap approval_step yang memutus bila ada.
DO $$
BEGIN
  IF to_regclass('approval_request') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('approval_step') IS NOT NULL THEN
    EXECUTE $q$
      UPDATE forecast_dokumen d SET
        review_status = CASE ar.status
          WHEN 'approved' THEN 'disetujui'
          WHEN 'pending' THEN 'menunggu'
          ELSE 'ditolak' END,
        reviewed_at = CASE WHEN ar.status = 'pending' THEN NULL ELSE COALESCE(st.decided_at, ar.decided_at) END,
        reviewed_by = CASE WHEN ar.status = 'pending' THEN NULL ELSE st.decided_by END,
        review_note = CASE WHEN ar.status = 'pending' THEN NULL ELSE st.decision_note END
      FROM approval_request ar
      LEFT JOIN LATERAL (
        SELECT s.decided_by, s.decided_at, s.decision_note
        FROM approval_step s
        WHERE s.request_id = ar.id AND s.status IN ('approved', 'rejected')
        ORDER BY (s.status = 'rejected') DESC, s.decided_at DESC NULLS LAST
        LIMIT 1
      ) st ON true
      WHERE ar.id = d.approval_request_id AND d.review_status IS NULL
    $q$;
  ELSE
    EXECUTE $q$
      UPDATE forecast_dokumen d SET
        review_status = CASE ar.status
          WHEN 'approved' THEN 'disetujui'
          WHEN 'pending' THEN 'menunggu'
          ELSE 'ditolak' END,
        reviewed_at = CASE WHEN ar.status = 'pending' THEN NULL ELSE ar.decided_at END
      FROM approval_request ar
      WHERE ar.id = d.approval_request_id AND d.review_status IS NULL
    $q$;
  END IF;
END $$;

-- (d) Grant ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON forecast_dokumen TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON forecast_dokumen TO wrg_readonly;
  END IF;
END $$;
