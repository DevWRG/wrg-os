-- F47 Kontrak KSO — dokumen kontrak (MoU, addendum, BAST, lainnya).
--
-- Satu kontrak bisa punya banyak dokumen. Berkasnya di disk server
-- (KSO_KONTRAK_UPLOAD_DIR, default ~/.wrg-os/uploads/kso-kontrak), yang
-- disimpan di sini hanya NAMA berkas relatif terhadap root itu — bukan path
-- absolut — jadi root dev/prod bisa beda tanpa data ikut salah.
--
-- Root ini SENGAJA tidak masuk allow-list GET /media (yang tanpa cek izin):
-- MoU berisi nilai kontrak, jadi unduhan hanya lewat
-- GET /kso-kontrak/:id/dokumen/:dokId yang dijaga izin kso-kontrak di BFF.
--
-- Perpanjangan kontrak membuat baris kso_kontrak baru; dokumen periode lama
-- tetap menempel di kontrak lamanya (tidak disalin).

CREATE TABLE IF NOT EXISTS kso_kontrak_dokumen (
  id              bigserial PRIMARY KEY,
  kontrak_id      bigint NOT NULL REFERENCES kso_kontrak(id) ON DELETE CASCADE,
  jenis           text NOT NULL CHECK (jenis IN ('MOU', 'ADDENDUM', 'BAST', 'LAINNYA')),
  nama_asli       text NOT NULL,
  nama_simpan     text NOT NULL UNIQUE,
  mime            text NOT NULL,
  ukuran          integer NOT NULL CHECK (ukuran > 0),
  keterangan      text,
  diunggah_oleh   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kso_kontrak_dokumen_kontrak_idx ON kso_kontrak_dokumen (kontrak_id, created_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON kso_kontrak_dokumen TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE kso_kontrak_dokumen_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_kontrak_dokumen TO wrg_readonly;
  END IF;
END $$;
