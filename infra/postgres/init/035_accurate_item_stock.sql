-- Tambah kolom stok ke accurate_item (dari item/list.do: quantity, availableToSell)
-- untuk menu Inventory. Diisi syncItems (full katalog 5.794 item).
ALTER TABLE accurate_item ADD COLUMN IF NOT EXISTS quantity  numeric(16,2);
ALTER TABLE accurate_item ADD COLUMN IF NOT EXISTS available numeric(16,2);
