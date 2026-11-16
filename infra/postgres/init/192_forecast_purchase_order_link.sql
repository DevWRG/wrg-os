-- 192 — F153 Auto-Draft PR: link forecast_suggestion (F19) -> purchase_order (F13).
--
-- forecast_suggestion yang sudah 'submitted' DAN approval_request-nya
-- 'approved' (F11) bisa di-convert jadi PO nyata (draftPurchaseOrder(),
-- forecast.ts). Vendor & lini bisnis dipilih MANUAL oleh Supply Chain di
-- form draft — sistem TAK PUNYA data "vendor default per item" sama sekali
-- (accurate_item mirror tak menyimpan itu, 2 tabel Accurate terpisah tanpa
-- link) — jadi "auto" di sini artinya item/qty/gudang prefilled dari
-- usulan, vendor & lini tetap keputusan manusia (sama pola add-purchase-
-- order-sheet.tsx yang sudah ada).
--
-- purchase_order_id dobel-fungsi: jejak PO hasil draft (bisa NULL kalau
-- suggestion itu belum/tak pernah didraft) SEKALIGUS guard idempotensi
-- (draftPurchaseOrder menolak kalau kolom ini sudah terisi, jangan draft
-- PO dobel dari usulan yang sama).
--
-- status 'ordered' ditambah ke CHECK constraint lama (satu-satunya cara
-- Postgres nambah value ke CHECK teks: drop lalu recreate dengan definisi
-- baru) — menandakan usulan ini sudah selesai siklusnya (draft -> submitted
-- -> ordered), beda dari 'submitted' yang berarti "masih menunggu approval".
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE forecast_suggestion
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_order (id) ON DELETE SET NULL;

ALTER TABLE forecast_suggestion DROP CONSTRAINT IF EXISTS forecast_suggestion_status_check;
ALTER TABLE forecast_suggestion ADD CONSTRAINT forecast_suggestion_status_check
  CHECK (status IN ('draft', 'submitted', 'dismissed', 'ordered'));

COMMENT ON COLUMN forecast_suggestion.purchase_order_id IS
  'F153 — PO (F13) hasil auto-draft dari usulan ini setelah approved F11. NULL = belum didraft.';
