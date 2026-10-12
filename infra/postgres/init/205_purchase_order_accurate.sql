-- 205 — F13 PO Tracker jadi CERMIN Accurate (keputusan user 12 Okt 2026).
--
-- Probe read-only 12 Okt 2026: Accurate sudah memegang seluruh siklus
-- pembelian — 2.683 PO (purchase-order), approval PO (approvalStatus),
-- penerimaan barang (receive-item, 2.870) dan faktur pembelian. PO Tracker
-- yang diisi tangan mencatat ULANG data itu, dengan approval F35 terpisah
-- yang bisa berbeda dari Accurate. Mulai migrasi ini, PO datang dari Accurate
-- (job accurate-po-sync), WRG-OS hanya memantau: telat, sisa qty, status.
--
-- Bentuknya sengaja menumpang tabel purchase_order/purchase_order_item yang
-- ada (bukan tabel mirror baru): status turunan, kartu KPI, pencarian, dan
-- tautan F153 forecast_suggestion.purchase_order_id sudah dibangun di atasnya.
-- Pembeda baris = kolom `source`; baris 'accurate' read-only di aplikasi.
--
-- Status baris Accurate dihitung dari HEADER (percent_shipped + status
-- Accurate), bukan dari purchase_order_receipt — penerimaan dicatat di
-- Accurate, jadi log barang masuk WRG-OS tak dipakai untuk baris ini.

ALTER TABLE purchase_order
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'accurate')),
  ADD COLUMN IF NOT EXISTS accurate_id bigint,
  -- statusName Accurate apa adanya: Menunggu diproses / Sebagian diproses /
  -- Terproses / Ditutup.
  ADD COLUMN IF NOT EXISTS accurate_status text,
  -- approvalStatus Accurate: APPROVED / UNAPPROVED (approval PO di Accurate,
  -- pengganti gate F35 untuk baris ini).
  ADD COLUMN IF NOT EXISTS accurate_approval text,
  ADD COLUMN IF NOT EXISTS percent_shipped numeric,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  -- lastUpdate Accurate. Detail (baris barang) ditarik ulang hanya bila nilai
  -- ini berubah sejak tarikan detail terakhir (items_last_update).
  ADD COLUMN IF NOT EXISTS accurate_last_update timestamptz,
  ADD COLUMN IF NOT EXISTS items_last_update timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_accurate_id_key
  ON purchase_order (accurate_id) WHERE accurate_id IS NOT NULL;

ALTER TABLE purchase_order_item
  ADD COLUMN IF NOT EXISTS accurate_detail_id bigint,
  ADD COLUMN IF NOT EXISTS item_no text,
  ADD COLUMN IF NOT EXISTS warehouse_name text,
  -- shipQuantity Accurate = qty yang sudah diterima lewat Penerimaan Barang.
  ADD COLUMN IF NOT EXISTS qty_shipped numeric;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_item_accurate_detail_id_key
  ON purchase_order_item (accurate_detail_id) WHERE accurate_detail_id IS NOT NULL;

COMMENT ON COLUMN purchase_order.source IS
  'F13 (205) — manual = diisi di WRG-OS (pra-cermin), accurate = disalin job accurate-po-sync, read-only.';
COMMENT ON COLUMN purchase_order.accurate_last_update IS
  'F13 (205) — lastUpdate Accurate; detail ditarik ulang bila beda dari items_last_update.';
COMMENT ON COLUMN purchase_order_item.qty_shipped IS
  'F13 (205) — shipQuantity Accurate (sudah diterima). Dipakai sebagai qty_received utk baris accurate.';
