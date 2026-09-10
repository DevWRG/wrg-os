-- 078 — F140 Vendor Management + Contract Expiry Alerts (Purchasing/GA,
-- role min HOD). Tidak ada FR spec resmi di board (F140 di luar
-- MAGANG-FEATURES.md — tier Direktur langsung, seperti F142 Price Book,
-- bukan alur magang). Fitur board paling mirip: F75 "Vendor/Partner Contract
-- Tracker (ACE retainer style)" (Todo, belum ada implementasi apa pun).
--
-- Keputusan desain dikonfirmasi user (Direktur) via AskUserQuestion:
--   1. Header (vendor_partner) + child (vendor_contract) TERPISAH, bukan flat
--      1-vendor-1-kontrak — supaya histori renewal kontrak lama tetap
--      tersimpan (kontrak baru = baris baru, bukan overwrite). Pola sama
--      dana-ops/inbound-receiving (header+item nested).
--   2. Contract expiry alert = STATUS COMPUTED DI QUERY/JS SAJA (badge UI),
--      TIDAK ADA cron/WA baru — pola sama F25 (annual renewal Uji Profisiensi).
--      Alasan: CLAUDE.md eksplisit, target broadcast WA harus ditentukan
--      user/Direktur, bukan diinferensi agent; user belum siapkan target grup.
--   3. Role min HOD (2 lapis gate nav.ts + requireHodOrAdmin BFF) — konsisten
--      F75/F40/F51, data kontrak/nilai komersial vendor dianggap sensitif.
--
-- vendor_partner independen dari accurate_vendor (migrasi 034, mirror
-- read-only Accurate `vendor/list.do` yg dipakai menu Suppliers) — tabel itu
-- cuma katalog nama+cabang tanpa kontak/status aktif/kontrak, tidak cocok
-- utk manajemen relasi vendor. accurate_vendor_id FK OPSIONAL disediakan
-- (ON DELETE SET NULL) utk vendor yg kebetulan juga tersinkron Accurate —
-- pola sama vendor_id opsional di F39 Supplier ETA Tracker. Tidak mengubah
-- tabel accurate_vendor itu sendiri.
--
-- vendor_contract.vendor_id ON DELETE CASCADE (bukan RESTRICT spt
-- atk_stock_movement F135) — kontrak adalah child data struktural milik
-- vendor (tanpa vendor, baris kontrak tidak punya konteks), pola sama
-- inbound_receiving_item/dana_ops_item, BUKAN pola "riwayat transaksi wajib
-- diproteksi" ala mutasi stok.
--
-- end_date NULLABLE (bukan NOT NULL) — kontrak "berjalan sampai dibatalkan"
-- tanpa tanggal akhir tetap memang ada di dunia nyata; end_date NULL berarti
-- TIDAK IKUT hitungan expiring/expired (pola sama ed_date NULL di F38: bukan
-- dianggap sudah lewat, cuma tidak dipantau ambang harinya).
--
-- category/contract_type SENGAJA free text (bukan CHECK enum tertutup) —
-- ragam vendor/partner & jenis kontrak (retainer, SLA, one-time, MOU, dst)
-- tidak dibatasi Direktur secara eksplisit; free text lebih fleksibel drpd
-- enum yg keburu sempit lalu perlu migrasi tiap ada jenis baru.

CREATE TABLE IF NOT EXISTS vendor_partner (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  category           text,
  contact_person     text,
  phone              text,
  email              text,
  address            text,
  cabang             text,
  accurate_vendor_id bigint REFERENCES accurate_vendor(id) ON DELETE SET NULL,
  is_active          boolean NOT NULL DEFAULT true,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_partner_is_active_idx ON vendor_partner (is_active);
CREATE INDEX IF NOT EXISTS vendor_partner_accurate_vendor_id_idx ON vendor_partner (accurate_vendor_id);

CREATE TABLE IF NOT EXISTS vendor_contract (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES vendor_partner(id) ON DELETE CASCADE,
  contract_number text,
  contract_type   text,
  start_date      date NOT NULL,
  end_date        date,
  value           numeric(16,2),
  terminated_at   timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_contract_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS vendor_contract_vendor_id_idx ON vendor_contract (vendor_id);
CREATE INDEX IF NOT EXISTS vendor_contract_end_date_idx ON vendor_contract (end_date);

COMMENT ON TABLE vendor_partner IS 'F140 Vendor Management — master vendor/partner lokal (independen dari mirror accurate_vendor), role min HOD.';
COMMENT ON TABLE vendor_contract IS 'F140 Contract Expiry Alerts — riwayat kontrak per vendor (histori renewal tersimpan), status expiring/expired computed dari end_date.';
