-- 076 — Tracking Pengiriman Digital (F12, SHIPPING): status kirim per SJ (dari
-- gudang/cabang pengirim ke customer) + ETA berbasis jarak (km, dihitung manual
-- oleh Admin Shipping, BUKAN integrasi Maps real-time — lihat
-- docs/features/F12-tracking-pengiriman-digital.md). State machine SEDERHANA
-- 3 langkah (TTF SENGAJA diabaikan, arahan Direktur rapat 2026-07-30):
--   draft → dikirim → bast
-- Hashtag WA pemicu: #KIRIM, #BAST (di-handle di apps/api/src/repo/inbound.ts,
-- match by sj_number — bukan lewat file terpisah).
--
-- SENGAJA self-contained / tanpa FK ke domain lain: sj_number TEXT bebas
-- (link "logical" ke accurate_delivery_order via nomor, bukan FK — pola sama
-- dgn F22 installation_unit.sj_number, ONBOARDING.md §2 domain terlarang CRM/HR).

CREATE TABLE IF NOT EXISTS shipment_tracking (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sj_number         text NOT NULL,
  customer_name     text NOT NULL,
  cabang            text,               -- titik asal (gudang/cabang pengirim)
  distance_km       numeric,            -- jarak cabang→customer, manual/dianalisa

  eta_days          integer,            -- estimasi hari tempuh dari distance_km
  eta_date          date,               -- target tanggal sampai

  driver_name       text,
  driver_wa_number  text,

  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','dikirim','bast')),

  kirim_at          timestamptz,
  kirim_photo_path  text,
  kirim_by          text,               -- sender_name WA pemicu #KIRIM (audit, bukan FK)

  bast_at           timestamptz,
  bast_photo_path   text,
  bast_by           text,               -- sender_name WA pemicu #BAST (audit, bukan FK)

  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipment_tracking_status_idx     ON shipment_tracking (status);
CREATE INDEX IF NOT EXISTS shipment_tracking_sj_number_idx  ON shipment_tracking (sj_number);
CREATE INDEX IF NOT EXISTS shipment_tracking_created_at_idx ON shipment_tracking (created_at DESC);

COMMENT ON TABLE shipment_tracking IS
  'F12 — Tracking Pengiriman Digital (SHIPPING): status kirim per SJ + ETA dari jarak (km), state machine draft→dikirim→bast, dipicu WA hashtag #KIRIM/#BAST.';
