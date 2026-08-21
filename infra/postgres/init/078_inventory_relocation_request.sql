-- 078 — F40 Inventory Relocation Request (PURCHASING/Supply Chain).
--
-- Tidak ada FR spec resmi di board (beda dari F37/F38/F39 yang punya GitHub
-- Issue detail) — hanya judul "Inventory Relocation Request" di
-- MAGANG-FEATURES.md, role min HOD. Didesain dari nol, keputusan dikonfirmasi
-- user (Direktur):
--   1. Flat, SATU jenis barang per request (bukan header+item) — mirip F39
--      Supplier ETA Tracker. Kalau perlu pindah banyak barang sekaligus,
--      cukup buat beberapa baris request.
--   2. Status 3-state pending→completed/cancelled (bukan 4-state shipment-like
--      dgn ETA, dan BUKAN approval formal 2-pihak) — krn SELURUH halaman ini
--      sudah di-gate HOD (requireHodOrAdmin di BFF + canView di nav/page),
--      jadi tak ada "Karyawan minta, HOD approve" — HOD yang sama mencatat &
--      menyelesaikan/membatalkan requestnya sendiri. Ini murni log/tracker
--      keputusan relokasi, bukan sistem approval formal.
--   3. TIDAK ada validasi terhadap stok riil di cabang asal — sistem ini tak
--      punya sumber data stok per-cabang yg bisa dipercaya utk produk umum
--      (accurate_item.quantity cuma total global; accurate_item/accurate_branch
--      ada di migrasi CRM mirror 013 — CRM off-limits magang, ONBOARDING.md §2;
--      atk_item beda domain/General Affairs). Pola sama dgn F39/F51: request
--      dicatat apa adanya, tanpa validasi ke "kebenaran" stok eksternal.
--
-- item_desc/cabang_asal/cabang_tujuan/requested_by SENGAJA free text, TANPA FK
-- ke tabel master mana pun — cabang di seluruh codebase ini selalu TEXT free
-- input (tak ada tabel master cabang di luar CRM), requested_by free text krn
-- bukan FK ke master_user/app_user (domain HR off-limits).
--
-- current_stock/computed status TIDAK ada di sini (beda dari atk_stock_movement
-- F49) — status disimpan literal (bukan computed), krn tak ada basis stok utk
-- dihitung.

CREATE TABLE IF NOT EXISTS inventory_relocation_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_desc      text NOT NULL,
  qty            numeric(14,2) NOT NULL CHECK (qty > 0),
  unit           text,
  cabang_asal    text NOT NULL,
  cabang_tujuan  text NOT NULL,
  reason         text,
  requested_by   text,
  request_date   date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at   timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_relocation_request_cabang_beda CHECK (cabang_asal <> cabang_tujuan)
);

CREATE INDEX IF NOT EXISTS inventory_relocation_request_status_idx
  ON inventory_relocation_request (status);
CREATE INDEX IF NOT EXISTS inventory_relocation_request_cabang_asal_idx
  ON inventory_relocation_request (cabang_asal);
CREATE INDEX IF NOT EXISTS inventory_relocation_request_cabang_tujuan_idx
  ON inventory_relocation_request (cabang_tujuan);

COMMENT ON TABLE inventory_relocation_request IS 'F40 Inventory Relocation Request — log permintaan pemindahan barang antar cabang, role min HOD (Purchasing/Supply Chain).';
