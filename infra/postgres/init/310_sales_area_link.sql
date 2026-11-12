-- 310 — tautan publik infografis Sales Area Performance (/sa/<token>).
--
-- Keputusan user 12 Nov 2026: link di ringkasan WA grup Koord HoD bisa dibuka TANPA login dari HP, berlaku
-- 2 hari (diperiksa API dari dibuat_at). Satu token acak 128-bit (base64url, 22 huruf) per tanggal; angka
-- tidak disimpan — halaman menghitung ulang dari faktur untuk tanggal itu (sama dengan /sales-analytics/area).

CREATE TABLE IF NOT EXISTS sales_area_link (
  tanggal    date PRIMARY KEY,
  token      text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  dibuat_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE sales_area_link IS
  '310: token tautan publik /sa/<token> infografis Sales Area per tanggal (tanpa login, berlaku 2 hari). Diisi ringkasan WA sales-area.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sales_area_link TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON sales_area_link TO wrg_readonly;
  END IF;
END $$;
