-- 070 — F136 ATK Stock Opname (General Affairs): Physical Count + Variance Adjustment.
--
-- Mencatat hasil hitung fisik barang ATK dibanding stok sistem (F49,
-- SUM in - SUM out dari atk_stock_movement). system_qty adalah SNAPSHOT saat
-- opname dibuat (diisi API dari query stock-levels), bukan dihitung ulang tiap
-- baca — kalau tidak, opname lama akan ikut berubah tiap ada mutasi baru
-- setelahnya (riwayat opname harus membekukan kondisi saat itu, mirip alasan
-- watchpoint_weekly membekukan metric mingguan). variance TETAP dihitung di
-- query/JS (counted_qty - system_qty), bukan kolom tersimpan, krn kedua input
-- (system_qty, counted_qty) sudah beku — pola computed yang sama dgn "telat"
-- F39 / "variance" F51 / "current_stock" F49.
--
-- item_id sengaja TANPA ON DELETE SET NULL/CASCADE (default RESTRICT) — sama
-- alasannya dgn atk_stock_movement.item_id (069): riwayat opname adalah audit
-- trail, barang yg pernah diopname tidak boleh hilang keterkaitannya.
--
-- adjustment_movement_id = link opsional ke atk_stock_movement penyesuaian yg
-- dibuat lewat FORM YANG SAMA dgn Stock In/Out (AddAtkStockMovementSheet,
-- mode "in" kalau surplus / "out" kalau selisih kurang) — F136 sengaja TIDAK
-- bikin form/tabel movement baru, cukup menyimpan hasil hitung fisik lalu
-- pakai form existing utk aksi penyesuaiannya. ON DELETE SET NULL (bukan
-- RESTRICT) — movement penyesuaian boleh dihapus/dikoreksi dari menu Stock In
-- tanpa memblokir; riwayat opname cukup kehilangan status "sudah disesuaikan".

CREATE TABLE IF NOT EXISTS atk_stock_opname (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                uuid NOT NULL REFERENCES atk_item(id),
  opname_date            date NOT NULL DEFAULT CURRENT_DATE,
  system_qty             numeric NOT NULL,
  counted_qty            numeric NOT NULL CHECK (counted_qty >= 0),
  counted_by             text,
  cabang                 text,
  notes                  text,
  adjustment_movement_id uuid REFERENCES atk_stock_movement(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atk_stock_opname_item_id_idx ON atk_stock_opname (item_id);
CREATE INDEX IF NOT EXISTS atk_stock_opname_opname_date_idx ON atk_stock_opname (opname_date);

COMMENT ON TABLE atk_stock_opname IS 'F136 ATK Stock Opname — hasil hitung fisik vs stok sistem (General Affairs), variance dihitung di query dari system_qty/counted_qty beku.';
