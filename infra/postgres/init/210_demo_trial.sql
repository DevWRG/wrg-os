-- 210 — F18 Trial/Demo Outcome Logger.
--
-- Keputusan user (2026-10-13):
--   • Demo dan trial DIBEDAKAN. Demo = presentasi/uji alat sekali datang;
--     trial = alat dipinjamkan/dipasang di faskes beberapa hari–minggu, punya
--     tanggal selesai (pengingat saat trial berakhir).
--   • Hasil DINILAI AM saat menutup: positif / netral / negatif + alasan.
--     Konversi per produk = positif ÷ yang sudah ditutup.
--   • Dicatat dari WA (#DEMO / #TRIAL), dari kartu deal di Pipeline, dan menu
--     Demo & Trial.
--
-- Tidak ikut KPI aktivitas AM — kunjungan demo SUDAH terhitung lewat #REPORT
-- tipe Demo (activity_log); tabel ini mencatat HASIL-nya, bukan kunjungannya.
-- account_id opsional: demo justru sering ke faskes yang BELUM pelanggan.
-- Additive & idempoten.

CREATE SEQUENCE IF NOT EXISTS demo_kode_seq START 1;
CREATE SEQUENCE IF NOT EXISTS trial_kode_seq START 1;

CREATE TABLE IF NOT EXISTS demo_trial (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jenis            text NOT NULL CHECK (jenis IN ('demo','trial')),
  kode             text NOT NULL UNIQUE,            -- DM-0001 / TR-0001 (diisi trigger)
  facility_name    text NOT NULL CHECK (btrim(facility_name) <> ''),
  account_id       bigint,                          -- accurate_customer.id bila sudah pelanggan (soft ref)
  deal_id          uuid,                            -- deal Pipeline yang ditautkan (soft ref)
  alat             text NOT NULL CHECK (btrim(alat) <> ''), -- alat/produk yang didemokan, apa adanya
  brand            text,
  tanggal          date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,  -- hari demo / mulai trial
  tanggal_selesai  date,                            -- trial: rencana selesai; demo: NULL
  catatan          text,
  hasil            text CHECK (hasil IS NULL OR hasil IN ('positif','netral','negatif')),
  alasan_hasil     text,
  ditutup_at       timestamptz,
  ditutup_oleh     text,
  am_id            text,
  cabang           text,                            -- penamaan master_user/hod_territory (gerbang scope HoD)
  source           text NOT NULL DEFAULT 'web' CHECK (source IN ('wa','web','pipeline')),
  created_by       text,
  group_jid        text,
  wa_message_id    text UNIQUE,
  reminder_at      timestamptz,                     -- pengingat trial berakhir (hanya bila WA terkirim live)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_trial_selesai CHECK (jenis = 'trial' OR tanggal_selesai IS NULL),
  CONSTRAINT demo_trial_urutan CHECK (tanggal_selesai IS NULL OR tanggal_selesai >= tanggal),
  CONSTRAINT demo_trial_hasil_konsisten CHECK ((hasil IS NULL) = (ditutup_at IS NULL))
);
CREATE INDEX IF NOT EXISTS demo_trial_account_idx ON demo_trial (account_id, tanggal DESC);
CREATE INDEX IF NOT EXISTS demo_trial_deal_idx    ON demo_trial (deal_id);
CREATE INDEX IF NOT EXISTS demo_trial_am_idx      ON demo_trial (am_id, hasil);
CREATE INDEX IF NOT EXISTS demo_trial_terbuka_idx ON demo_trial (jenis, tanggal_selesai) WHERE hasil IS NULL;

-- Kode per jenis dari sequence masing-masing: DM-0001… dan TR-0001…
CREATE OR REPLACE FUNCTION demo_trial_kode() RETURNS trigger AS $$
BEGIN
  IF NEW.kode IS NULL OR NEW.kode = '' THEN
    NEW.kode := CASE NEW.jenis
      WHEN 'demo'  THEN 'DM-' || lpad(nextval('demo_kode_seq')::text, 4, '0')
      ELSE              'TR-' || lpad(nextval('trial_kode_seq')::text, 4, '0') END;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS demo_trial_kode_trg ON demo_trial;
CREATE TRIGGER demo_trial_kode_trg BEFORE INSERT ON demo_trial FOR EACH ROW EXECUTE FUNCTION demo_trial_kode();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON demo_trial TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE demo_kode_seq, trial_kode_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON demo_trial TO wrg_readonly;
  END IF;
END $$;
