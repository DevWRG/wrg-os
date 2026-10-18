-- 235 — F154 Jadwal Kunjungan Rutin Teknisi (auto-generate, terbit sebelum tgl 1).
--
-- MANDIRI dari modul Aftersales dev (instalasi 130 / PM 133 / kapasitas 136 belum di
-- prod) — keputusan user 18 Okt 2026. Sumber populasi = alat KSO operasional
-- (kso_asset + kso_asset_status_v + penempatan F169); teknisi = master_user role Teknisi.
-- Teknisi tak punya akun dashboard (prod 18 Okt: 5 teknisi, semua berbasis Pusat) →
-- jadwal sampai ke mereka lewat WA (terbit + #JADWAL).
--
-- Nomor 235: 234 ganda di dev (dua berkas sesi lain), 224–233 = F170.

-- Wilayah (area faskes, = upper(area_customer(account_id))) → satu teknisi penanggung jawab.
CREATE TABLE IF NOT EXISTS teknisi_wilayah (
  wilayah     text PRIMARY KEY,
  teknisi_id  text NOT NULL,              -- master_user.am_id (role Teknisi)
  oleh        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Frekuensi kunjungan rutin per faskes (override). Tanpa baris = default per skema
-- (PER_TEST 2 bulan, BELI_REAGEN 3 bulan — ditetapkan di kode, keputusan user 18 Okt).
CREATE TABLE IF NOT EXISTS jadwal_rutin_frekuensi (
  account_id     bigint PRIMARY KEY,
  interval_bulan smallint NOT NULL CHECK (interval_bulan BETWEEN 1 AND 12),
  catatan        text,
  oleh           text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Status penyusunan per bulan: draft (boleh disusun ulang & diedit) → terbit (terkirim ke teknisi).
CREATE TABLE IF NOT EXISTS jadwal_rutin_bulan (
  bulan        date PRIMARY KEY CHECK (extract(day FROM bulan) = 1),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'terbit')),
  disusun_at   timestamptz,
  disusun_oleh text,
  terbit_at    timestamptz,
  terbit_oleh  text
);

CREATE TABLE IF NOT EXISTS jadwal_rutin (
  id          bigserial PRIMARY KEY,
  bulan       date NOT NULL REFERENCES jadwal_rutin_bulan(bulan) ON DELETE CASCADE,
  tanggal     date NOT NULL,
  urutan      smallint NOT NULL DEFAULT 1,
  teknisi_id  text,                       -- NULL = wilayah belum punya teknisi
  account_id  bigint NOT NULL,
  wilayah     text,
  alat        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- snapshot [{sn, nama, skema}]
  status      text NOT NULL DEFAULT 'rencana' CHECK (status IN ('rencana', 'selesai', 'batal')),
  sumber      text NOT NULL DEFAULT 'auto' CHECK (sumber IN ('auto', 'manual')),
  catatan     text,
  selesai_at  timestamptz,
  oleh        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (date_trunc('month', tanggal)::date = bulan)
);
-- Satu kunjungan rutin aktif per faskes per bulan (yang batal tak dihitung).
CREATE UNIQUE INDEX IF NOT EXISTS jadwal_rutin_satu_per_bulan ON jadwal_rutin (bulan, account_id) WHERE status <> 'batal';
CREATE INDEX IF NOT EXISTS jadwal_rutin_teknisi_tgl ON jadwal_rutin (teknisi_id, tanggal);
CREATE INDEX IF NOT EXISTS jadwal_rutin_akun ON jadwal_rutin (account_id, tanggal);

COMMENT ON TABLE jadwal_rutin IS
  'F154: kunjungan rutin teknisi ke faskes KSO. Disusun otomatis per bulan (draft), diedit HoD Aftersales, lalu diterbitkan (WA ke teknisi). Riwayat selesai = dasar jatuh tempo kunjungan berikutnya.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON teknisi_wilayah, jadwal_rutin_frekuensi, jadwal_rutin_bulan, jadwal_rutin TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE jadwal_rutin_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON teknisi_wilayah, jadwal_rutin_frekuensi, jadwal_rutin_bulan, jadwal_rutin TO wrg_readonly;
  END IF;
END $$;
