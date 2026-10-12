-- 167 — cabut pemetaan NTB → GUDANG MATARAM (id 600) dari allowlist F37.
--
-- Migrasi 166 memetakan `NTB` ke gudang Accurate id 600 ("GUDANG MATARAM")
-- atas dasar KECOCOKAN NAMA saja — Mataram ibu kota NTB — dan komentarnya
-- sendiri menandai baris itu "BELUM dikonfirmasi orang". Pemilik fitur
-- memutuskan 2026-09-06: **cabut sampai ada yang mengonfirmasi**.
--
-- Kenapa ini penting dan bukan kerapian: pemetaan yang salah TIDAK
-- memunculkan error. Puller akan menulis saldo gudang Mataram ke kolom NTB,
-- angkanya tampil rapi di matriks Stok Gudang, dan satu-satunya cara
-- ketahuannya adalah ada orang yang kebetulan hafal stok NTB. Tebakan yang
-- gagal dalam diam lebih buruk daripada kolom yang jujur kosong.
--
-- ── KENAPA MIGRASI BARU, BUKAN MENGEDIT 166 ──
-- 166 sudah merged ke `dev` dan sudah dijalankan di setidaknya satu database
-- (wrg_os_dev laptop). Ledger `schema_migrations` memakai NAMA FILE, jadi
-- mengedit isinya tak akan pernah dieksekusi ulang di database yang sudah
-- mencatatnya — barisnya akan tetap ada di sana, diam-diam. Yang additive
-- benar untuk KEDUA populasi:
--   · database baru  : 166 menyisipkan, 167 mencabut → bersih di akhir run;
--   · database lama  : 167 mencabut yang sudah terlanjur ada.
--
-- Akibat pencabutan: `NTB` sekarang berperilaku sama dengan lima cabang tanpa
-- padanan (LAMONGAN/TUBAN/JOGJA/SOLO/NTT) — puller tak pernah menyentuhnya,
-- dan stoknya tetap berasal dari CSV opname tim gudang (`source='import'`).
-- Kartu ringkasan menampilkan `sumber`, jadi bedanya terbaca tanpa perlu tahu
-- soal file ini.
--
-- Kalau nanti ADA yang mengonfirmasi bahwa GUDANG MATARAM memang gudang NTB:
-- kembalikan lewat migrasi BARU (INSERT ke warehouse_accurate), jangan
-- menghidupkan kembali baris di 166.
--
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner yang mengatur
-- transaksi.

-- Sengaja dikunci ke pasangan (id, kode) yang persis, bukan `WHERE
-- warehouse_kode = 'NTB'` saja: kalau suatu saat NTB dipetakan ulang ke gudang
-- yang SUDAH dikonfirmasi, migrasi ini tak boleh ikut mencabutnya.
DELETE FROM warehouse_accurate
 WHERE accurate_warehouse_id = 600
   AND warehouse_kode = 'NTB';

-- Baris stok yang mungkin terlanjur ditulis puller untuk NTB. Hanya yang
-- ber-source='accurate' — angka CSV/manual milik tim gudang JANGAN disentuh,
-- itu data sah yang tak ada hubungannya dengan pemetaan keliru ini.
DELETE FROM item_stock_branch
 WHERE warehouse_kode = 'NTB'
   AND source = 'accurate';
