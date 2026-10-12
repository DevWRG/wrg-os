-- 095 — F23 RFID/Cartridge Error Claim Tracker (Aftersales).
--
-- Klaim internal saat alat + cartridge (mis. point-of-care analyzer) menunjukkan
-- error pembacaan RFID. Flat table, 1 baris = 1 insiden (bukan header+item —
-- tiap error dilaporkan per-kejadian, tak ada kebutuhan gabung banyak cartridge
-- dalam satu pengajuan). Tracking internal saja, TANPA integrasi kirim klaim ke
-- vendor/prinsipal (belum ada kebutuhan itu).
--
-- customer_name/reported_by sengaja free text, BUKAN FK ke accurate_customer/
-- master_user/app_user — domain CRM & HR off-limits (pola sama dgn rs_name F25,
-- requested_by F51).
--
-- status: pending -> resolved | rejected. closed_at distempel/dibersihkan
-- otomatis di repo utk KEDUA terminal state (beda dari pola completed_at F40
-- yg cuma 1 terminal state) — supaya durasi penyelesaian klaim tetap terukur
-- apa pun hasil akhirnya (diganti atau ditolak).
--
-- Bukti foto (layar error / cartridge) disimpan sbg bytea, belum ada object
-- storage terpakai di repo ini. Additive + idempoten. Tanpa BEGIN/COMMIT
-- (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS rfid_cartridge_claim (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  device_name       text NOT NULL,
  cartridge_name    text NOT NULL,
  lot_number        text,
  serial_number     text,
  customer_name     text NOT NULL,
  error_description text NOT NULL,
  reported_date     date NOT NULL DEFAULT CURRENT_DATE,
  reported_by       text NOT NULL,
  cabang            text,

  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
  resolution_notes  text,
  closed_at         timestamptz,
  notes             text,

  -- Bukti foto — opsional, cap ukuran/mime ditegakkan di layer aplikasi (bukan
  -- CHECK constraint DB, konsisten pola validasi F25).
  file_name         text,
  file_mime         text,
  file_size         integer,
  file_data         bytea,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfid_cartridge_claim_status ON rfid_cartridge_claim(status);
CREATE INDEX IF NOT EXISTS idx_rfid_cartridge_claim_reported_date ON rfid_cartridge_claim(reported_date);
