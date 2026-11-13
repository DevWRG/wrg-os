-- anonymize-bank-account.sql — WAJIB dijalankan di environment DEMO setelah migrasi.
--
-- KENAPA: migrasi 169_bank_cashin.sql meng-INSERT rekening bank perusahaan yang
-- SUNGGUHAN (nomor rekening, nama pemilik, cabang, catatan operasional berisi
-- plafon/saldo) ke tabel bank_account. Migrasi itu jalan di SEMUA environment,
-- jadi DB demo — yang akunnya dibagikan ke tim — ikut memuatnya.
--
-- Skrip ini menimpa kolom pengenal dengan nilai sintetis. Nama bank, kode SWIFT,
-- dan jenis rekening dipertahankan supaya menu Cash-in tetap masuk akal.
-- label_file ikut diganti karena memuat potongan nomor rekening asli; kode tak
-- menyimpan label itu (pencocokan statement membaca label dari DB).
--
-- Idempoten: aman dijalankan ulang (urutan label hasil penyamaran tetap stabil).
-- Menolak jalan di database yang bukan *_demo.

SELECT current_database() LIKE '%\_demo' AS is_demo \gset
\if :is_demo
\else
  \set ON_ERROR_STOP 1
  DO $$ BEGIN RAISE EXCEPTION 'ABORT: anonymize-bank-account.sql hanya untuk database *_demo (sekarang: %)', current_database(); END $$;
  \quit
\endif

BEGIN;

WITH n AS (
  SELECT id, bank_kode,
         row_number() OVER (ORDER BY label_file)                        AS i,
         row_number() OVER (PARTITION BY bank_kode ORDER BY label_file) AS j,
         count(*)     OVER (PARTITION BY bank_kode)                     AS c
  FROM bank_account
)
UPDATE bank_account b SET
  label_file   = CASE WHEN n.c > 1 THEN n.bank_kode || ' ' || chr(64 + n.j::int) ELSE n.bank_kode END,
  no_rekening  = CASE WHEN b.no_rekening IS NULL THEN NULL ELSE '99000000' || lpad(n.i::text, 2, '0') END,
  nama_pemilik = CASE WHEN b.nama_pemilik IS NULL THEN NULL ELSE 'PT DEMO SEJAHTERA' END,
  cabang       = NULL,
  catatan      = 'Rekening contoh (demo) — ' ||
                 CASE b.jenis WHEN 'kas'          THEN 'rekening operasional'
                              WHEN 'prk_pinjaman' THEN 'fasilitas PRK'
                              WHEN 'deposito'     THEN 'deposito'
                              ELSE 'giro escrow' END,
  updated_at   = now()
FROM n WHERE n.id = b.id;

COMMIT;

\echo 'Anonimisasi rekening bank selesai (bank_account).'
