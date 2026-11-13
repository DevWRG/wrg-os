-- Proyek HD fase 2 — data operasional per proyek (pindahan tab-tab Google Sheets tracker):
-- konstruksi + kurva S, RO & utilitas, mesin, keuangan (termin & tagihan), permintaan RS,
-- isu & risiko, dan funnel calon proyek. Semua baris: soft delete (dihapus_at) +
-- cek tabrakan tulis lewat diubah_at. PIC = employee (dipilih lewat UI).

CREATE TABLE IF NOT EXISTS hd_konstruksi (
  id                     BIGSERIAL PRIMARY KEY,
  proyek_id              BIGINT NOT NULL REFERENCES hd_proyek(id),
  lingkup                TEXT,
  kontraktor             TEXT,
  spk_wrg                BOOLEAN NOT NULL DEFAULT false,
  spk_sipil              BOOLEAN NOT NULL DEFAULT false,
  bq_internal            BOOLEAN NOT NULL DEFAULT false,
  bq_versi_rs            BOOLEAN NOT NULL DEFAULT false,
  bq_disepakati          BOOLEAN NOT NULL DEFAULT false,
  ttd_manajemen_rs       BOOLEAN NOT NULL DEFAULT false,
  timeline_internal_bln  NUMERIC(6,1) CHECK (timeline_internal_bln >= 0),
  timeline_rs_bln        NUMERIC(6,1) CHECK (timeline_rs_bln >= 0),
  mulai                  DATE,
  target_selesai         TEXT CHECK (target_selesai ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pct_rencana            NUMERIC(5,1) CHECK (pct_rencana BETWEEN 0 AND 100),
  pct_aktual             NUMERIC(5,1) CHECK (pct_aktual BETWEEN 0 AND 100),
  dibayar                NUMERIC(16,2) CHECK (dibayar >= 0),
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

-- Kurva S mingguan (kumulatif). Satu baris per proyek per minggu.
CREATE TABLE IF NOT EXISTS hd_kurva_s (
  id           BIGSERIAL PRIMARY KEY,
  proyek_id    BIGINT NOT NULL REFERENCES hd_proyek(id),
  minggu_ke    INT NOT NULL CHECK (minggu_ke > 0),
  pct_rencana  NUMERIC(5,1) CHECK (pct_rencana BETWEEN 0 AND 100),
  pct_aktual   NUMERIC(5,1) CHECK (pct_aktual BETWEEN 0 AND 100),
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS hd_kurva_s_minggu_uq ON hd_kurva_s (proyek_id, minggu_ke) WHERE dihapus_at IS NULL;

CREATE TABLE IF NOT EXISTS hd_ro (
  id             BIGSERIAL PRIMARY KEY,
  proyek_id      BIGINT NOT NULL REFERENCES hd_proyek(id),
  kapasitas_gdp  INT CHECK (kapasitas_gdp >= 0),
  status_ro      TEXT,
  vendor         TEXT,
  spk_ro         BOOLEAN NOT NULL DEFAULT false,
  nilai          NUMERIC(16,2) CHECK (nilai >= 0),
  dibayar        NUMERIC(16,2) CHECK (dibayar >= 0),
  jadwal_masuk   DATE,
  uji_air        BOOLEAN NOT NULL DEFAULT false,
  listrik_ok     BOOLEAN NOT NULL DEFAULT false,
  pipa_ok        BOOLEAN NOT NULL DEFAULT false,
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

-- Relokasi & cek mesin.
CREATE TABLE IF NOT EXISTS hd_mesin (
  id            BIGSERIAL PRIMARY KEY,
  proyek_id     BIGINT NOT NULL REFERENCES hd_proyek(id),
  merk          TEXT,
  jumlah_unit   INT CHECK (jumlah_unit >= 0),
  dari          TEXT,
  ke            TEXT,
  tujuan        TEXT,
  surat_dasar   TEXT,
  target_tiba   DATE,
  status        TEXT,
  cek_teknis    TEXT,
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

-- Termin & tagihan proyek (masuk dari RS / keluar ke kontraktor-vendor).
CREATE TABLE IF NOT EXISTS hd_keuangan (
  id           BIGSERIAL PRIMARY KEY,
  proyek_id    BIGINT NOT NULL REFERENCES hd_proyek(id),
  arah         TEXT NOT NULL CHECK (arah IN ('Masuk', 'Keluar')),
  pihak        TEXT,
  keterangan   TEXT,
  nilai        NUMERIC(16,2) CHECK (nilai >= 0),
  jatuh_tempo  DATE,
  status       TEXT CHECK (status IN ('Belum', 'Ditagih', 'Lunas')),
  tgl_bayar    DATE,
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

-- Permintaan tambahan RS (G4: yang terkait izin dulu; aksesori setelah BPJS running).
CREATE TABLE IF NOT EXISTS hd_permintaan (
  id         BIGSERIAL PRIMARY KEY,
  proyek_id  BIGINT NOT NULL REFERENCES hd_proyek(id),
  item       TEXT NOT NULL CHECK (btrim(item) <> ''),
  kategori   TEXT CHECK (kategori IN ('Wajib izin', 'Aksesori')),
  estimasi   NUMERIC(16,2) CHECK (estimasi >= 0),
  status     TEXT CHECK (status IN ('Belum', 'Proses', 'Selesai')),
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hd_isu (
  id               BIGSERIAL PRIMARY KEY,
  proyek_id        BIGINT NOT NULL REFERENCES hd_proyek(id),
  isu              TEXT NOT NULL CHECK (btrim(isu) <> ''),
  dampak           TEXT,
  tindakan         TEXT,
  pic_employee_id  TEXT REFERENCES employee(id),
  target           DATE,
  status           TEXT NOT NULL DEFAULT 'Terbuka' CHECK (status IN ('Terbuka', 'Proses', 'Selesai')),
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

-- Funnel calon proyek — boleh belum punya proyek (proyek_id NULL).
CREATE TABLE IF NOT EXISTS hd_funnel (
  id               BIGSERIAL PRIMARY KEY,
  proyek_id        BIGINT REFERENCES hd_proyek(id),
  nama_rs          TEXT NOT NULL CHECK (btrim(nama_rs) <> ''),
  wilayah          TEXT,
  segmen           TEXT CHECK (segmen IN ('Kemenkes', 'RSUD/Pemda', 'TNI/Polri', 'Swasta')),
  tipe_proyek      TEXT CHECK (tipe_proyek IN ('Start New', 'Pindah/Relokasi', 'Tambah Unit', 'Replacement')),
  est_unit         INT CHECK (est_unit >= 0),
  vendor_existing  TEXT,
  pipeline         TEXT CHECK (pipeline IN ('Cold', 'Warm', 'Hot')),
  target           TEXT CHECK (target ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pic_employee_id  TEXT REFERENCES employee(id),
  dibuat_oleh TEXT, dibuat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT, diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dihapus_oleh TEXT, dihapus_at TIMESTAMPTZ
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hd_konstruksi', 'hd_kurva_s', 'hd_ro', 'hd_mesin', 'hd_keuangan', 'hd_permintaan', 'hd_isu', 'hd_funnel'] LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (proyek_id) WHERE dihapus_at IS NULL', t || '_proyek_idx', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wrg_app', t);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO wrg_app', t || '_id_seq');
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
      EXECUTE format('GRANT SELECT ON %I TO wrg_readonly', t);
    END IF;
  END LOOP;
END $$;
