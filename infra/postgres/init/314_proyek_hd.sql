-- Proyek HD — tracker proyek hemodialisa (KSO) dari Deal sampai layanan berjalan,
-- plus Simulator HD. Pindahan app terpisah "Tracker Proyek HD" (Next.js + Google
-- Sheets) menjadi modul WRG-OS — keputusan user 13 Nov 2026.
--
-- 7 tahap berurutan; hanya satu tahap Berjalan, sebelumnya Selesai, sesudahnya
-- Belum mulai. Tahap 6 bercabang: 6a BPJS approval, 6b Layanan Umum, 6c Bypass
-- (khusus Tambah Unit) — semuanya posisi ke-6.
--
-- Lampiran catatan tahap disimpan di Google Drive PRIVAT (folder
-- GDRIVE_HD_FOLDER_ID, akun OAuth yang sama dgn F156), diunduh lewat API berizin.
--
-- Angka uang (tarif klaim, harga consumable/mesin, porsi bagi hasil) TIDAK
-- disemai di sini — repo publik. Kunci parameternya disemai dengan nilai NULL
-- dan diisi admin lewat layar Parameter.

CREATE TABLE IF NOT EXISTS hd_proyek (
  id                   BIGSERIAL PRIMARY KEY,
  kode                 TEXT NOT NULL UNIQUE CHECK (kode ~ '^PRJ-[0-9]{4,}$'),
  account_id           BIGINT REFERENCES accurate_customer(id),
  nama_rs              TEXT NOT NULL CHECK (btrim(nama_rs) <> ''),
  kota                 TEXT,
  segmen               TEXT CHECK (segmen IN ('Kemenkes', 'RSUD/Pemda', 'TNI/Polri', 'Swasta')),
  tipe_proyek          TEXT NOT NULL CHECK (tipe_proyek IN ('Start New', 'Pindah/Relokasi', 'Tambah Unit', 'Replacement')),
  prioritas            TEXT NOT NULL DEFAULT 'Gas' CHECK (prioritas IN ('Replace', 'Gas', 'Hold')),
  nama_alat            TEXT,
  unit_kso             INT NOT NULL DEFAULT 0 CHECK (unit_kso >= 0),
  unit_terinstal       INT NOT NULL DEFAULT 0 CHECK (unit_terinstal >= 0),
  unit_running         INT NOT NULL DEFAULT 0 CHECK (unit_running >= 0),
  harga_unit           NUMERIC(16,2) CHECK (harga_unit >= 0),
  nomor_kontrak        TEXT,
  target_tindakan_bln  INT CHECK (target_tindakan_bln >= 0),
  target_golive        TEXT CHECK (target_golive ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tahap_kode           TEXT NOT NULL DEFAULT '1' CHECK (tahap_kode IN ('1', '2', '3', '4', '5', '6a', '6b', '6c', '7')),
  status_rag           TEXT NOT NULL DEFAULT 'Kuning' CHECK (status_rag IN ('Hijau', 'Kuning', 'Merah')),
  pic_employee_id      TEXT REFERENCES employee(id),
  next_action          TEXT,
  dibuat_oleh          TEXT,
  dibuat_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh          TEXT,
  diubah_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh         TEXT,
  dihapus_at           TIMESTAMPTZ,
  CHECK (unit_running <= unit_terinstal),
  CHECK (tahap_kode <> '6c' OR tipe_proyek = 'Tambah Unit')
);
CREATE INDEX IF NOT EXISTS hd_proyek_tahap_idx ON hd_proyek (tahap_kode) WHERE dihapus_at IS NULL;
CREATE INDEX IF NOT EXISTS hd_proyek_account_idx ON hd_proyek (account_id) WHERE account_id IS NOT NULL;

-- Catatan per tahap (boleh hanya lampiran). Tahap catatan = tahap berjalan saat ditulis.
CREATE TABLE IF NOT EXISTS hd_catatan (
  id          BIGSERIAL PRIMARY KEY,
  proyek_id   BIGINT NOT NULL REFERENCES hd_proyek(id),
  tahap_kode  TEXT NOT NULL,
  tanggal     DATE NOT NULL,
  catatan     TEXT NOT NULL DEFAULT '',
  oleh        TEXT,
  dibuat_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hd_catatan_proyek_idx ON hd_catatan (proyek_id, tanggal DESC, id DESC);

CREATE TABLE IF NOT EXISTS hd_lampiran (
  id             BIGSERIAL PRIMARY KEY,
  catatan_id     BIGINT NOT NULL REFERENCES hd_catatan(id),
  proyek_id      BIGINT NOT NULL REFERENCES hd_proyek(id),
  drive_file_id  TEXT NOT NULL,
  nama_asli      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  ukuran         INT NOT NULL CHECK (ukuran > 0),
  diunggah_oleh  TEXT,
  diunggah_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hd_lampiran_catatan_idx ON hd_lampiran (catatan_id);

-- Perpindahan tahap. dari_tahap NULL = proyek dibuat.
CREATE TABLE IF NOT EXISTS hd_riwayat_tahap (
  id          BIGSERIAL PRIMARY KEY,
  proyek_id   BIGINT NOT NULL REFERENCES hd_proyek(id),
  dari_tahap  TEXT,
  ke_tahap    TEXT NOT NULL,
  tanggal     DATE NOT NULL,
  oleh        TEXT,
  dibuat_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hd_riwayat_tahap_proyek_idx ON hd_riwayat_tahap (proyek_id, tanggal DESC, id DESC);

-- Hasil Simulator HD yang disimpan per proyek. `input` = parameter lengkap untuk dibuka ulang.
-- jenis margin_wrg memuat biaya & margin WRG — hanya dilayani ke pemegang fitur proyek-hd-margin.
CREATE TABLE IF NOT EXISTS hd_simulasi (
  id          BIGSERIAL PRIMARY KEY,
  proyek_id   BIGINT NOT NULL REFERENCES hd_proyek(id),
  jenis       TEXT NOT NULL CHECK (jenis IN ('proyeksi_rs', 'margin_wrg')),
  label       TEXT,
  input       JSONB NOT NULL,
  ringkasan   TEXT NOT NULL DEFAULT '',
  oleh        TEXT,
  dibuat_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hd_simulasi_proyek_idx ON hd_simulasi (proyek_id, jenis, dibuat_at DESC);

-- Parameter tracker & default simulator. Awalan kunci menentukan pembaca:
--   (tanpa awalan) tracker · rs_ = tab Proyeksi RS · margin_ = tab Margin WRG (pemegang proyek-hd-margin saja).
CREATE TABLE IF NOT EXISTS hd_param (
  kunci        TEXT PRIMARY KEY CHECK (kunci ~ '^[a-z][a-z0-9_]*$'),
  nilai        NUMERIC,
  keterangan   TEXT NOT NULL,
  urut         INT NOT NULL DEFAULT 0,
  diubah_oleh  TEXT,
  diubah_at    TIMESTAMPTZ
);

INSERT INTO hd_param (kunci, nilai, keterangan, urut) VALUES
  ('tarif_per_tindakan',        NULL, 'Tarif per tindakan untuk estimasi omset proyek (Rp)', 10),
  ('tindakan_per_mesin_bln',    48,   'Kapasitas tindakan per mesin per bulan', 11),
  ('basis_bulan_target',        84,   'Basis bulan target tindakan PKS (G6)', 12),
  ('target_rasio_running_idle', 1,    'Target rasio running : idle', 13),
  ('rs_mesin',                  10,   'Proyeksi RS — mesin aktif', 20),
  ('rs_shift',                  2,    'Proyeksi RS — shift per mesin per hari', 21),
  ('rs_hari',                   24,   'Proyeksi RS — hari operasi per bulan', 22),
  ('rs_tarif_klaim',            NULL, 'Proyeksi RS — tarif klaim per tindakan (Rp)', 23),
  ('rs_porsi_pct',              NULL, 'Proyeksi RS — porsi Wahana bila bagi hasil (%)', 24),
  ('rs_harga_tetap',            NULL, 'Proyeksi RS — harga tetap per tindakan (Rp)', 25),
  ('margin_needle',             NULL, 'Margin — fistula needle, harga satuan ex PPN (dipakai ×2)', 30),
  ('margin_circuit',            NULL, 'Margin — blood circuit ex PPN', 31),
  ('margin_bicarb',             NULL, 'Margin — bicarbonate cartridge ex PPN', 32),
  ('margin_acid',               NULL, 'Margin — acid concentrate ex PPN', 33),
  ('margin_dialyzer',           NULL, 'Margin — dialyzer ex PPN', 34),
  ('margin_harga_mesin',        NULL, 'Margin — mesin HD per unit ex PPN', 35),
  ('margin_ro',                 NULL, 'Margin — RO + pipanisasi + instalasi ex PPN', 36),
  ('margin_mesin',              30,   'Margin — mesin aktif', 40),
  ('margin_backup',             3,    'Margin — mesin backup', 41),
  ('margin_tindakan_per_hari',  2,    'Margin — tindakan per mesin per hari', 42),
  ('margin_hari',               24,   'Margin — hari operasional per bulan', 43),
  ('margin_tenor',              8,    'Margin — tenor KSO (tahun)', 44),
  ('margin_pendapatan',         NULL, 'Margin — pendapatan WRG per tindakan (Rp)', 45),
  ('margin_share_pct',          100,  'Margin — revenue sharing WRG (%)', 46),
  ('margin_gaji_teknisi',       NULL, 'Margin — gaji teknisi per bulan (Rp, ×13/tahun)', 50),
  ('margin_fee_dpjp',           NULL, 'Margin — fee DPJP per tindakan (Rp)', 51),
  ('margin_kirim',              NULL, 'Margin — kirim consumable per tindakan (Rp)', 52),
  ('margin_lab_air',            NULL, 'Margin — lab air per tahun (Rp)', 53),
  ('margin_diklat',             NULL, 'Margin — diklat perawat per tahun (Rp)', 54),
  ('margin_kalibrasi',          NULL, 'Margin — kalibrasi per mesin per tahun (Rp, mulai tahun ke-2)', 55),
  ('margin_pitnas',             NULL, 'Margin — Pitnas-Pitwil per tahun (Rp)', 56),
  ('margin_renovasi',           0,    'Margin — renovasi + inventaris, sekali (Rp)', 57),
  ('margin_lain_per_tindakan',  NULL, 'Margin — biaya kecil lain per tindakan (Rp)', 58),
  ('margin_lain_harian',        NULL, 'Margin — biaya kecil lain per hari operasi (Rp)', 59),
  ('margin_lain_bln',           NULL, 'Margin — biaya kecil lain per bulan (Rp)', 59),
  ('margin_min_pct',            15,   'Margin — ambang minimum untuk tanda tangan (%)', 60)
ON CONFLICT (kunci) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hd_proyek', 'hd_catatan', 'hd_lampiran', 'hd_riwayat_tahap', 'hd_simulasi', 'hd_param'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wrg_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
      EXECUTE format('GRANT SELECT ON %I TO wrg_readonly', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['hd_proyek', 'hd_catatan', 'hd_lampiran', 'hd_riwayat_tahap', 'hd_simulasi'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO wrg_app', t || '_id_seq');
    END IF;
  END LOOP;
END $$;
