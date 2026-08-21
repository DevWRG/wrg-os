-- 095 — `number` jadi kunci identitas mirror SO/DO (bukan `id` Accurate).
--
-- Accurate MENGGANTI id dokumen ketika dokumen diedit/diterbitkan ulang, sementara
-- nomor dokumennya tetap. Karena upsertSalesOrders/upsertDeliveryOrders memakai
-- ON CONFLICT (id), dokumen yang id-nya berganti masuk sebagai BARIS BARU dan baris
-- lama menjadi yatim: id-nya tak lagi menunjuk dokumen mana pun, sehingga
-- detail.do menolaknya dengan "Pengiriman Pesanan tidak tepat" dan
-- items_synced_at-nya NULL selamanya (dicoba ulang tiap siklus, tak pernah berhasil).
--
-- Terukur di prod 2026-08-13: 39 delivery-order macet — 17 di antaranya duplikat
-- yatim (nomor sama, baris pasangannya sudah lengkap; sudah dihapus manual), 7 masih
-- hidup di Accurate dengan id berbeda, 15 memang tak ada lagi. Pergeseran id-nya
-- dua arah (67309→67500, tapi juga 66700→66354), jadi bukan offset yang bisa ditebak.
--
-- Perbaikannya: jadikan `number` kunci unik, lalu upsert konflik di `number` dan
-- MEMPERBARUI id-nya. Supaya baris item ikut pindah saat id induk berubah, FK-nya
-- perlu ON UPDATE CASCADE (sebelumnya hanya ON DELETE CASCADE).
--
-- Prasyarat sudah diverifikasi sebelum migrasi ini ditulis: 0 number NULL dan
-- 0 number duplikat di kedua tabel (accurate_sales_order 1847 baris,
-- accurate_delivery_order 1824 baris).

-- Kunci unik. Parsial (WHERE number IS NOT NULL) supaya baris tanpa nomor — kalau
-- suatu saat muncul — tidak saling memblokir; jalur upsert untuk kasus itu tetap
-- memakai ON CONFLICT (id).
CREATE UNIQUE INDEX IF NOT EXISTS accurate_so_number_key
  ON accurate_sales_order (number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accurate_do_number_key
  ON accurate_delivery_order (number) WHERE number IS NOT NULL;

-- FK baris item harus ikut saat id induk diperbarui. DROP+ADD karena Postgres tak
-- punya ALTER CONSTRAINT untuk mengubah aksi referensial.
ALTER TABLE accurate_sales_order_item
  DROP CONSTRAINT IF EXISTS accurate_sales_order_item_order_id_fkey;
ALTER TABLE accurate_sales_order_item
  ADD CONSTRAINT accurate_sales_order_item_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES accurate_sales_order (id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE accurate_delivery_order_item
  DROP CONSTRAINT IF EXISTS accurate_delivery_order_item_delivery_id_fkey;
ALTER TABLE accurate_delivery_order_item
  ADD CONSTRAINT accurate_delivery_order_item_delivery_id_fkey
  FOREIGN KEY (delivery_id) REFERENCES accurate_delivery_order (id)
  ON UPDATE CASCADE ON DELETE CASCADE;

COMMENT ON INDEX accurate_so_number_key IS
  'Nomor dokumen = identitas stabil; id Accurate berubah saat dokumen diedit.';
COMMENT ON INDEX accurate_do_number_key IS
  'Nomor dokumen = identitas stabil; id Accurate berubah saat dokumen diedit.';
