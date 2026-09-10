-- F4 #CEK: index lookup nomor dokumen (SO/SJ/Faktur) exact-match case-insensitive.
-- Ketiga tabel belum terindex utk `number` (cuma trans_date/customer_id), tambah
-- functional index lower(number) supaya findDocByNumber() (cek.ts) gak full-scan.
CREATE INDEX IF NOT EXISTS accurate_so_number_idx ON accurate_sales_order (lower(number));
CREATE INDEX IF NOT EXISTS accurate_do_number_idx ON accurate_delivery_order (lower(number));
CREATE INDEX IF NOT EXISTS accurate_invoice_number_idx ON accurate_invoice (lower(number));
