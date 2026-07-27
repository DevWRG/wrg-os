-- 065_customer_target_cabang — target jumlah customer aktif per cabang/tahun.
-- Sumber untuk aspek NPK "Customer Count Growth" (bobot 15). Mirror pola
-- sales_target_cabang (047): target tahunan per cabang, di-/2 utk semester +
-- pro-rata elapsed saat men-skor (lihat gatherAspectInput di repo/npk.ts).
-- Aspek customer tetap available:false sampai baris target cabang terisi (>0),
-- sama seperti revenue butuh sales_target_cabang. Additive, idempoten.

CREATE TABLE IF NOT EXISTS customer_target_cabang (
  year       int         NOT NULL,
  cabang     text        NOT NULL,
  target     numeric     NOT NULL DEFAULT 0,   -- target jumlah customer aktif (count) setahun
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, cabang)
);
