-- 213 — F56 Onboarding Checklist Karyawan Baru (HR). Additive, idempoten.
--
-- Tiga tabel:
--   onboarding_template — butir checklist per kategori (akses sistem / training / NDA /
--                         alat / grup WA), opsional dibatasi dept & pola jabatan.
--                         Isinya DATA yang diedit HRD, bukan kode.
--   onboarding_case     — satu proses onboarding satu karyawan (employee, migrasi 052).
--   onboarding_item     — butir checklist milik case. SNAPSHOT dari template saat case
--                         dimulai: template diubah kemudian tidak menggeser case berjalan.
--
-- Nomor 213 (bukan 212): 212 dipakai F58 (feature_usage_event, PR #1664).

CREATE TABLE IF NOT EXISTS onboarding_template (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kategori     text NOT NULL CHECK (kategori IN ('akses_sistem','training','nda','alat','grup_wa')),
  judul        text NOT NULL,
  keterangan   text,
  dept         text REFERENCES department(key) ON DELETE SET NULL, -- NULL = semua departemen
  role_pattern text,                                                -- NULL = semua jabatan; cocok sebagian, huruf besar/kecil diabaikan
  due_days     int  NOT NULL DEFAULT 7 CHECK (due_days >= 0),        -- tenggat = tanggal mulai + N hari
  pic          text,                                                -- label penanggung jawab (mis. HRD, IT, HoD)
  urut         int  NOT NULL DEFAULT 0,
  aktif        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_template_aktif_idx ON onboarding_template (aktif, kategori, urut);

CREATE TABLE IF NOT EXISTS onboarding_case (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id    text NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  tanggal_mulai  date NOT NULL,
  status         text NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan','selesai','dibatalkan')),
  catatan        text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  selesai_at     timestamptz
);
-- Satu karyawan hanya boleh punya SATU onboarding berjalan.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_case_berjalan_uq ON onboarding_case (employee_id) WHERE status = 'berjalan';
CREATE INDEX IF NOT EXISTS onboarding_case_status_idx ON onboarding_case (status, tanggal_mulai DESC);

CREATE TABLE IF NOT EXISTS onboarding_item (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id      bigint NOT NULL REFERENCES onboarding_case(id) ON DELETE CASCADE,
  template_id  bigint REFERENCES onboarding_template(id) ON DELETE SET NULL,
  kategori     text NOT NULL CHECK (kategori IN ('akses_sistem','training','nda','alat','grup_wa')),
  judul        text NOT NULL,
  keterangan   text,
  pic          text,
  urut         int  NOT NULL DEFAULT 0,
  due_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'belum' CHECK (status IN ('belum','selesai','dilewati')),
  catatan      text,
  done_by      text,
  done_at      timestamptz
);
CREATE INDEX IF NOT EXISTS onboarding_item_case_idx ON onboarding_item (case_id, kategori, urut);

COMMENT ON TABLE onboarding_item IS
  'Snapshot butir template saat case dimulai (F56). status dilewati = tidak berlaku untuk orang ini; wajib dengan catatan alasan.';

-- Butir awal (umum, semua jabatan). HRD menyunting/menambah di menu; baris ini sekadar titik mulai.
INSERT INTO onboarding_template (kategori, judul, keterangan, due_days, pic, urut)
SELECT v.kategori, v.judul, v.keterangan, v.due_days, v.pic, v.urut
FROM (VALUES
  ('akses_sistem', 'Akun dashboard WRG-OS dibuat & password awal diganti', 'Akun app_user + grup akses sesuai jabatan', 1, 'HRD', 10),
  ('akses_sistem', 'Nomor WA terdaftar di roster & grup kerja', 'Dipakai bot untuk #PLAN/#REPORT dan reminder', 1, 'HRD', 20),
  ('training',     'Pengenalan WRG-OS & alur kerja harian', 'Sesi orientasi oleh HoD/penerima', 7, 'HoD', 10),
  ('nda',          'Perjanjian kerahasiaan (NDA) ditandatangani', 'Arsip salinan di HRD', 3, 'HRD', 10),
  ('alat',         'Perlengkapan kerja diserahkan', 'Laptop/HP/seragam sesuai jabatan; catat di Aset GA bila aset tercatat', 3, 'GA', 10),
  ('grup_wa',      'Dimasukkan ke grup WA divisi', 'Grup tim sesuai jabatan', 1, 'HoD', 10)
) AS v(kategori, judul, keterangan, due_days, pic, urut)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_template);
