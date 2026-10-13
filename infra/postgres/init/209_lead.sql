-- 209 — F65 Leads Capture & Qualification (+ auto-routing).
--
-- Keputusan user (2026-10-13):
--   • Lead = tabel TERPISAH dari deal. Lead yang lolos kualifikasi dikonversi
--     jadi deal Prospecting di Pipeline; prospek mentah tak mencemari pipeline
--     maupun forecast.
--   • Kualifikasi BANT: lolos bila minimal 3 dari 4 terpenuhi (Budget = pagu/
--     anggaran ada, Authority = pengambil keputusan dikenal, Need = kebutuhan
--     alat/parameter jelas, Timeline = perkiraan bulan beli).
--   • Sumber v1: WA #LEADS, form web (menu Leads), impor pameran/seminar.
--   • Lead yang tak ditindaklanjuti: pengingat ke AM setelah 3 hari kerja, ke
--     HoD setelah 7 hari kerja (job lead-aging, flag default MATI).
--
-- Routing: kota → AM lewat master_territory (kota yang dipegang >1 AM TIDAK
-- ditebak); cabang ikut master_user.cabang AM, atau area_kota bila AM tak
-- terpetakan; HoD dari hod_territory. Kolom cabang memakai penamaan
-- master_user/hod_territory (mis. 'SBY 2'), BUKAN penamaan lama master_territory
-- ('SURABAYA 2') — gerbang scope HoD membandingkan cabang persis.
-- Additive & idempoten.

CREATE SEQUENCE IF NOT EXISTS lead_kode_seq START 1;

CREATE TABLE IF NOT EXISTS lead (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode             text NOT NULL UNIQUE DEFAULT ('LD-' || lpad(nextval('lead_kode_seq')::text, 4, '0')),
  facility_name    text NOT NULL CHECK (btrim(facility_name) <> ''),
  city             text,
  account_id       bigint,                          -- accurate_customer.id bila faskesnya sudah pelanggan (soft ref)
  kebutuhan        text,                            -- Need dalam kata-kata pelapor
  brand            text,
  product          text,
  product_category text CHECK (product_category IS NULL OR product_category IN ('IVD','Medical')),
  estimate_amount  numeric,
  purchase_month   smallint CHECK (purchase_month IS NULL OR purchase_month BETWEEN 1 AND 12),
  purchase_year    smallint,
  contact_name     text,
  contact_role     text,
  contact_phone    text,
  notes            text,
  -- BANT
  bant_budget      boolean NOT NULL DEFAULT false,
  bant_authority   boolean NOT NULL DEFAULT false,
  bant_need        boolean NOT NULL DEFAULT false,
  bant_timeline    boolean NOT NULL DEFAULT false,
  bant_skor        smallint GENERATED ALWAYS AS (
                     bant_budget::int + bant_authority::int + bant_need::int + bant_timeline::int) STORED,
  -- asal
  source           text NOT NULL CHECK (source IN ('wa','web','pameran','referral','telepon','lpse','lainnya')),
  source_detail    text,                            -- mis. nama pameran, nama perujuk
  -- alur
  status           text NOT NULL DEFAULT 'baru'
                   CHECK (status IN ('baru','dihubungi','dikonversi','ditolak')),
  alasan_tolak     text,
  -- routing
  am_id            text,
  pic_hod          text,                            -- hod_key (rocky/yogi/…)
  cabang           text,
  routing_via      text NOT NULL DEFAULT 'manual'
                   CHECK (routing_via IN ('wilayah','pengirim','manual','tak-terpetakan')),
  -- konversi
  deal_id          uuid,
  converted_at     timestamptz,
  -- jejak
  created_by       text,
  group_jid        text,
  wa_message_id    text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- pengingat aging (diisi job lead-aging HANYA bila WA benar-benar terkirim)
  reminder_am_at   timestamptz,
  reminder_hod_at  timestamptz,
  CONSTRAINT lead_konversi_konsisten CHECK ((status = 'dikonversi') = (deal_id IS NOT NULL)),
  CONSTRAINT lead_tolak_beralasan CHECK (status <> 'ditolak' OR btrim(COALESCE(alasan_tolak,'')) <> '')
);
CREATE INDEX IF NOT EXISTS lead_status_idx ON lead (status, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_am_idx     ON lead (am_id, status);
CREATE INDEX IF NOT EXISTS lead_cabang_idx ON lead (upper(btrim(cabang)), status);
CREATE INDEX IF NOT EXISTS lead_nama_trgm  ON lead USING gin (facility_name gin_trgm_ops);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON lead TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE lead_kode_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON lead TO wrg_readonly;
  END IF;
END $$;
