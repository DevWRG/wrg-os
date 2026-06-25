-- 045 — Tambah kolom satuan (unit) ke accurate_item.
-- Sumber: Accurate item/list.do field `unit1` (objek {name,id}) → unit1.name
-- (mis. "BOX", "TUBE", "PCS"). Dipakai utk kolom "Satuan" di menu Inventory.
-- Additive, nullable, idempoten. Diisi via syncItems (re-sync setelah migrasi).
ALTER TABLE accurate_item ADD COLUMN IF NOT EXISTS unit text;
