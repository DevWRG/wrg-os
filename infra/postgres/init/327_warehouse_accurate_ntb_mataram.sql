-- 327 — pulihkan pemetaan NTB → GUDANG MATARAM (id 600) di allowlist F37.
--
-- 166 sempat memetakannya atas dasar kecocokan nama, lalu 167 mencabutnya
-- "sampai ada yang mengonfirmasi". Pemilik fitur mengonfirmasi 2026-11-17:
-- GUDANG MATARAM memang gudang cabang NTB. Sesuai pesan 167, dikembalikan
-- lewat migrasi BARU, bukan menghidupkan baris di 166.
--
-- Efek: puller stok per gudang (stok-gudang-sync, harian) mulai menulis saldo
-- Mataram ke NTB pada sapuan berikutnya; F19 Forecast ikut memakainya.
--
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner yang mengatur
-- transaksi.

INSERT INTO warehouse_accurate (accurate_warehouse_id, warehouse_kode, accurate_name, catatan) VALUES
  (600, 'NTB', 'GUDANG MATARAM', 'Dikonfirmasi pemilik fitur 2026-11-17 (membatalkan 167)')
ON CONFLICT (accurate_warehouse_id) DO UPDATE SET
  warehouse_kode = EXCLUDED.warehouse_kode,
  accurate_name  = EXCLUDED.accurate_name,
  catatan        = EXCLUDED.catatan;
