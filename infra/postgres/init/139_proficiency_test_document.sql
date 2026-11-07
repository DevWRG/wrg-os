-- 077 — F25 Uji Profisiensi Document Registry (AFTERSALES/Teknis).
--
-- Registry sertifikat Uji Profisiensi per RS/faskes pelanggan — tracking ED
-- (annual renewal) + penyimpanan file sertifikat.
--
-- rs_name SENGAJA free text, TIDAK ada FK ke accurate_customer — mirror
-- Accurate/CRM off-limits utk magang (lihat ONBOARDING.md §2), pola sama
-- dgn vendor_name di F39 (bebas dari accurate_vendor demi alasan berbeda,
-- di sini demi hindari domain CRM sama sekali).
--
-- File sertifikat disimpan sbg bytea LANGSUNG di Postgres (file_data),
-- bukan lewat object storage (S3/dsb) — tak ada integrasi storage terpakai
-- di codebase ini (placeholder AWS_S3_* di .env.example belum ada kodenya),
-- dan menambah itu masuk domain Infrastruktur yg off-limits magang. Ukuran
-- sertifikat kecil (PDF/scan), jadi bytea wajar utk skala fitur ini —
-- cap ukuran & mime ditegakkan di layer API (index.ts), bukan di DB.
--
-- Status ED (valid/segera berakhir/kedaluwarsa) DIHITUNG di query (expired_date
-- vs CURRENT_DATE), bukan kolom tersimpan — pola computed yg sama dgn "telat"
-- F39 / "stok rendah" F49 / "variance" F51. Tidak ada job scheduler WA baru
-- ditambahkan utk fitur ini (lihat catatan di repo/proficiency-test.ts).

CREATE TABLE IF NOT EXISTS proficiency_test_document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rs_name       text NOT NULL,
  test_name     text NOT NULL,
  provider      text,
  cert_number   text,
  issued_date   date,
  expired_date  date NOT NULL,
  cabang        text,
  pic           text,
  notes         text,
  file_name     text,
  file_mime     text,
  file_size     integer,
  file_data     bytea,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proficiency_test_document_expired_date_idx
  ON proficiency_test_document (expired_date);
CREATE INDEX IF NOT EXISTS proficiency_test_document_rs_name_idx
  ON proficiency_test_document (rs_name);

COMMENT ON TABLE proficiency_test_document IS 'F25 Uji Profisiensi Document Registry — sertifikat per RS, tracking ED renewal tahunan (Aftersales/Teknis).';
