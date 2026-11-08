-- 238 — F32 Bukti Pembayaran: arsip foto bukti bayar yang ditandai KODE PENGAJUAN.
--
-- Keputusan Direktur 2026-10-19: tanpa WA, tanpa OCR, tanpa pencocokan ke Accurate —
-- admin cukup mengunggah foto + kode pengajuan di dashboard, accounting yang
-- merekonsiliasi sendiri. Karena itu `kode_pengajuan` SENGAJA teks bebas (divalidasi
-- formatnya di API), tanpa FK ke tabel mana pun: tak ada kode pengajuan seragam di
-- repo (OT-0001, APR-0001, CN-00001; fund_request bahkan tak punya kode).
--
-- Berkas disimpan di disk (BUKTI_PEMBAYARAN_UPLOAD_DIR), BUKAN di DB; tabel ini hanya
-- metadata. Append-only: tak ada kolom/aksi ubah atau hapus — ini bukti.
-- Satu kode boleh punya beberapa bukti (tiap unggahan = satu baris).
-- Idempoten (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS bukti_pembayaran (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode_pengajuan  text        NOT NULL,                 -- sudah dinormalkan: huruf besar, tanpa spasi pinggir
  catatan         text,
  nama_asli       text        NOT NULL,                 -- nama berkas dari pengunggah (sudah dibersihkan)
  nama_simpan     text        NOT NULL UNIQUE,          -- nama acak di disk, relatif terhadap root unggahan
  mime            text        NOT NULL,                 -- dari ISI berkas (magic bytes), bukan label browser
  ukuran          integer     NOT NULL CHECK (ukuran > 0),
  diunggah_oleh   text,                                 -- dari SESI di BFF, bukan dari body
  diunggah_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bukti_pembayaran_kode_chk CHECK (kode_pengajuan ~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$')
);
CREATE INDEX IF NOT EXISTS bukti_pembayaran_kode_idx ON bukti_pembayaran (kode_pengajuan);
CREATE INDEX IF NOT EXISTS bukti_pembayaran_at_idx   ON bukti_pembayaran (diunggah_at DESC, id DESC);

COMMENT ON TABLE bukti_pembayaran IS
  'F32 — arsip foto bukti pembayaran bertanda kode pengajuan (teks bebas). Append-only; accounting merekonsiliasi sendiri.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    -- Sengaja tanpa UPDATE/DELETE: bukti tak boleh diubah atau dihapus lewat aplikasi.
    GRANT SELECT, INSERT ON bukti_pembayaran TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON bukti_pembayaran TO wrg_readonly;
  END IF;
END $$;
