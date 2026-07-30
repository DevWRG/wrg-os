-- 068 — Kendaraan Operasional Log (F50, OPS): per-vehicle log (km, BBM,
-- service, STNK expiry, sopir) + auto-alert service due (km-based) &
-- STNK expiry (H-30, lihat apps/api/src/repo/vehicle.ts).
--
-- `vehicle` = master data KECIL & JARANG BERUBAH (7 mobil per deskripsi
-- fitur) — SENGAJA tanpa halaman "tambah kendaraan" (lihat ONBOARDING/
-- kebiasaan magang: master data kecil = seed, bukan CRUD). Skema ini
-- TIDAK berisi data (migrasi jalan ke prod juga) — seed dev-only ada di
-- scripts/db/seed-vehicle-dev.sql, data PRODUKSI (7 mobil asli) perlu
-- di-input manual oleh Direktur/Fafa sebelum fitur ini dipakai sungguhan.
--
-- `vehicle_log` = data TRANSAKSIONAL (terus bertambah tiap ada isi BBM/
-- update km/service) — ini yang punya halaman input di web.
--
-- SENGAJA self-contained: sopir_name TEXT bebas, bukan FK ke master_user
-- (sopir belum tentu karyawan terdaftar di HR — sama filosofi dgn
-- teknisi_name di F22).

CREATE TABLE IF NOT EXISTS vehicle (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  plate_number           text NOT NULL UNIQUE,
  model                  text,
  sopir_name             text,

  current_km             numeric,

  stnk_expiry            date,
  stnk_alert_sent_at     timestamptz,

  service_interval_km    numeric NOT NULL DEFAULT 5000,
  last_service_km        numeric,
  last_service_date      date,
  service_alert_sent_at  timestamptz,

  active                 boolean NOT NULL DEFAULT true,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicle(id),

  log_type      text NOT NULL CHECK (log_type IN ('km','bbm','service')),
  log_date      date NOT NULL DEFAULT current_date,

  km            numeric,
  bbm_liter     numeric,
  bbm_cost      numeric,
  note          text,

  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_active_idx        ON vehicle (active);
CREATE INDEX IF NOT EXISTS vehicle_log_vehicle_idx    ON vehicle_log (vehicle_id, log_date DESC);

COMMENT ON TABLE vehicle IS
  'F50 — Kendaraan Operasional Log (OPS): master 7 mobil (seed manual, bukan CRUD), status STNK/service-due dihitung dari sini.';
COMMENT ON TABLE vehicle_log IS
  'F50 — riwayat entri km/BBM/service per kendaraan (transaksional, terus bertambah).';
