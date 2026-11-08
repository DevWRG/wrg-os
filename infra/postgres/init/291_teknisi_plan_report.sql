-- 291 — F175 Plan & Report Teknisi (format WA khusus Aftersales, per alat).
-- Spesifikasi: docs/features/F175-plan-report-teknisi.md (disetujui user 6 Nov 2026).
--
-- TERPISAH dari sales_plan / activity_log supaya metrik kunjungan sales tak
-- tercampur kunjungan teknisi, dan karena bentuk datanya beda: satu kunjungan
-- teknisi = banyak ALAT, masing-masing dengan status sendiri.
--
-- Rujukan ke tabel modul Aftersales (installation_unit, maintenance_schedule,
-- service_ticket, install_schedule) SENGAJA tanpa FK: modul itu baru ada di dev,
-- belum di main. Dengan FK, migrasi ini tak bisa dipromosikan duluan. Rujukan ke
-- tabel yang sudah ada di main (accurate_customer, kso_asset, jadwal_rutin)
-- memakai FK biasa.
--
-- Teknisi = master_user.am_id (sama dengan jadwal_rutin.teknisi_id, F154).

-- Item #PLAN: satu baris = satu alat yang direncanakan dikunjungi hari itu.
CREATE TABLE IF NOT EXISTS teknisi_plan_item (
  id                      bigserial PRIMARY KEY,
  teknisi_id              text        NOT NULL,
  tanggal                 date        NOT NULL,
  urut                    smallint    NOT NULL,
  account_id              bigint      REFERENCES accurate_customer(id) ON DELETE SET NULL,
  faskes_teks             text        NOT NULL,
  kso_asset_id            bigint      REFERENCES kso_asset(id) ON DELETE SET NULL,
  installation_unit_id    uuid,
  sn_teks                 text,
  alat_teks               text,
  jenis                   text        NOT NULL CHECK (jenis IN
                            ('PM','Service','Install','Uji Fungsi','Tarik Alat','Training','Kalibrasi','Call')),
  tiket_teks              text,
  jadwal_rutin_id         bigint      REFERENCES jadwal_rutin(id) ON DELETE SET NULL,
  maintenance_schedule_id uuid,
  service_ticket_id       uuid,
  install_schedule_id     uuid,
  -- Teks hasil pencocokan faskes/alat ("faskes tak ditemukan", "SN … ada 2 kandidat").
  catatan_cocok           text,
  wa_message_id           text,
  is_late                 boolean     NOT NULL DEFAULT false,
  submitted_at            timestamptz NOT NULL DEFAULT now(),
  -- Diisi saat item dilaporkan (status apa pun) — kunjungan_alat merujuk balik.
  reported_at             timestamptz,
  -- Diisi job Plan Tidak Realisasi bila tak dilaporkan s/d batas.
  tidak_realisasi_at      timestamptz,
  UNIQUE (teknisi_id, tanggal, urut)
);
CREATE INDEX IF NOT EXISTS teknisi_plan_item_tgl ON teknisi_plan_item (tanggal, teknisi_id);
COMMENT ON TABLE teknisi_plan_item IS
  'F175: item #PLAN Teknisi per alat. Kirim ulang #PLAN di hari yang sama mengganti item yang BELUM dilaporkan.';

-- Header #REPORT: satu kunjungan (satu faskes) per pesan.
CREATE TABLE IF NOT EXISTS teknisi_kunjungan (
  id             bigserial PRIMARY KEY,
  teknisi_id     text        NOT NULL,
  tanggal        date        NOT NULL,
  account_id     bigint      REFERENCES accurate_customer(id) ON DELETE SET NULL,
  faskes_teks    text,
  catatan        text,
  wa_message_id  text        UNIQUE,
  reported_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teknisi_kunjungan_tgl ON teknisi_kunjungan (tanggal, teknisi_id);

-- Per alat dalam satu kunjungan.
CREATE TABLE IF NOT EXISTS teknisi_kunjungan_alat (
  id                    bigserial PRIMARY KEY,
  kunjungan_id          bigint      NOT NULL REFERENCES teknisi_kunjungan(id) ON DELETE CASCADE,
  nomor_blok            smallint    NOT NULL,
  plan_item_id          bigint      REFERENCES teknisi_plan_item(id) ON DELETE SET NULL,
  kso_asset_id          bigint      REFERENCES kso_asset(id) ON DELETE SET NULL,
  installation_unit_id  uuid,
  sn_teks               text,
  alat_teks             text,
  jenis                 text        CHECK (jenis IN
                          ('PM','Service','Install','Uji Fungsi','Tarik Alat','Training','Kalibrasi','Call')),
  status                text        NOT NULL CHECK (status IN ('Selesai','Pending','Batal','Revisit')),
  alasan                text,
  kegiatan              text,
  jumlah_tes            integer     CHECK (jumlah_tes IS NULL OR jumlah_tes >= 0),
  sparepart             text,
  catatan               text,
  -- true = identitas faskes/alat tak bisa dipastikan mesin; perlu ditinjau orang.
  perlu_cek             boolean     NOT NULL DEFAULT false,
  catatan_cocok         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kunjungan_id, nomor_blok)
);
CREATE INDEX IF NOT EXISTS teknisi_kunjungan_alat_plan ON teknisi_kunjungan_alat (plan_item_id);
CREATE INDEX IF NOT EXISTS teknisi_kunjungan_alat_asset ON teknisi_kunjungan_alat (kso_asset_id);
COMMENT ON COLUMN teknisi_kunjungan_alat.jumlah_tes IS
  'Counter tes yang dibaca teknisi di alat saat kunjungan — bahan produktivitas KSO per alat per tanggal.';

-- Foto kunjungan. kunjungan_alat_id NULL = foto kunjungan umum (tak terikat alat).
CREATE TABLE IF NOT EXISTS teknisi_kunjungan_foto (
  id                 bigserial PRIMARY KEY,
  kunjungan_id       bigint      NOT NULL REFERENCES teknisi_kunjungan(id) ON DELETE CASCADE,
  kunjungan_alat_id  bigint      REFERENCES teknisi_kunjungan_alat(id) ON DELETE SET NULL,
  media_path         text        NOT NULL,
  wa_message_id      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kunjungan_id, media_path)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON teknisi_plan_item, teknisi_kunjungan, teknisi_kunjungan_alat, teknisi_kunjungan_foto TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE teknisi_plan_item_id_seq, teknisi_kunjungan_id_seq,
      teknisi_kunjungan_alat_id_seq, teknisi_kunjungan_foto_id_seq TO wrg_app;
  END IF;
END $$;
