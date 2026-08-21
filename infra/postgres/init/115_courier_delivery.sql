-- 095 — F43 Kurir/Ekspedisi Performance Dashboard.
--
-- Modul BARU, berdiri sendiri (dev belum punya tabel shipment/delivery
-- ber-kurir apa pun — accurate_delivery_order [037] cuma mirror Accurate
-- tanpa kolom kurir). Tidak menyambung ke shipment_tracking/pickup_plan
-- (branch shipping F12/F42/F45/F93 belum merge ke dev per keputusan sesi ini).
--
-- kurir_name/kurir_wa_number SENGAJA teks bebas, TANPA FK ke master data mana
-- pun — tidak ada roster kurir/ekspedisi di project ini (pola sama filosofi
-- "self-contained" F22/F12: kurir eksternal/internal dicatat manual per baris).
--
-- is_late/is_overdue/duration_days DIHITUNG di query/JS (bukan kolom
-- tersimpan) — pola computed yang sama dgn "telat" F39, "variance" F51.
-- target_tiba_date opsional: baris tanpa target tidak pernah dianggap
-- telat/overdue (tak ada janji waktu untuk dibandingkan).

CREATE TABLE IF NOT EXISTS courier_delivery (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kurir_name        text NOT NULL,
  kurir_wa_number   text,
  sj_number         text,
  customer_name     text,
  cabang            text,
  tanggal_kirim     date NOT NULL DEFAULT CURRENT_DATE,
  target_tiba_date  date,
  tanggal_tiba      date,
  distance_km       numeric(10,2) CHECK (distance_km IS NULL OR distance_km >= 0),
  status            text NOT NULL DEFAULT 'dalam_perjalanan'
                       CHECK (status IN ('dalam_perjalanan','selesai','bermasalah')),
  notes             text,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (tanggal_tiba IS NULL OR tanggal_tiba >= tanggal_kirim)
);

CREATE INDEX IF NOT EXISTS courier_delivery_kurir_name_idx ON courier_delivery (kurir_name);
CREATE INDEX IF NOT EXISTS courier_delivery_tanggal_kirim_idx ON courier_delivery (tanggal_kirim);
CREATE INDEX IF NOT EXISTS courier_delivery_status_idx ON courier_delivery (status);

COMMENT ON TABLE courier_delivery IS
  'F43 Kurir/Ekspedisi Performance Dashboard — log pengiriman per kurir, standalone (tanpa FK master kurir/ekspedisi).';
