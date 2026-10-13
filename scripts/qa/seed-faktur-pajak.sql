-- Data dummy F27 Faktur Pajak — untuk uji tulis manual di DB DEV LOKAL (jangan ke prod).
-- Idempoten: aman dijalankan ulang (hapus dulu lalu isi). Semua id ≥ 9100000000, no. invoice "FPT-…".
-- Tanggal RELATIF terhadap hari ini supaya kasus terlambat/aman tetap benar kapan pun dijalankan.
--
--   psql "$DATABASE_URL" -f scripts/qa/seed-faktur-pajak.sql
--   hapus saja: jalankan blok "BERSIHKAN" di bawah (3 baris DELETE) tanpa INSERT.
--
-- Prasyarat: migrasi 219 sudah diterapkan.

-- ── BERSIHKAN ────────────────────────────────────────────────────────────────
DELETE FROM faktur_pajak WHERE invoice_id >= 9100000000;
DELETE FROM accurate_invoice WHERE id >= 9100000000;
DELETE FROM accurate_customer WHERE id >= 9100000000;

-- ── CUSTOMER ─────────────────────────────────────────────────────────────────
INSERT INTO accurate_customer (id, no, name, raw) VALUES
  (9100000001, 'FPT-C01', 'RS FPT UJI SEJAHTERA',            '{"npwpNo":"01.234.567.8-901.000"}'),
  (9100000002, 'FPT-C02', '',                                 '{"npwpNo":"02.345.678.9-012.000"}'),   -- nama '' → fallback raw invoice
  (9100000003, 'FPT-C03', 'KLINIK FPT TANPA NPWP',            '{}'),                                  -- NPWP kosong
  (9100000004, 'FPT-C04', 'PT FPT & SONS <b>"Uji"</b> ''Kutip'' ' || repeat('PANJANG ', 12), '{"npwpNo":"   "}'); -- karakter khusus, nama sangat panjang, NPWP spasi saja

-- ── INVOICE ──────────────────────────────────────────────────────────────────
-- Kolom: id, no, customer, tanggal, DPP, PPN
--   KANDIDAT (muncul di dialog "Ajukan faktur pajak")
--     01 aman       : tanggal 1 bulan ini                    → batas 15 bulan depan (tidak terlambat)
--     02 aman       : 5 hari lalu
--     03 terlambat  : tgl 10 dua bulan lalu                  → batas 15 bulan lalu (SELALU terlambat)
--     04 batas jendela (disertakan)   : tepat hari ini − 4 bulan
--     05 batas jendela (DIKELUARKAN)  : hari ini − 4 bulan − 1 hari  → TIDAK muncul di daftar kandidat
--     06 customer nama '' (fallback nama dari raw invoice)
--     07 customer tanpa NPWP
--     08 karakter khusus + nama panjang (uji XSS/overflow tampilan)
--     09 angka besar + desimal (Rp 9.999.999.999.999 / PPN berpecahan sen)
--     10 PPN sangat kecil (Rp 1)
--   BUKAN KANDIDAT / NEGATIF
--     11 PPN = 0     → tak boleh diajukan (API 422)
--     12 PPN NULL    → idem
--     13 tanggal NULL → idem
--   DIPAKAI FP SEEDED (lihat bawah): 20–27
INSERT INTO accurate_invoice (id, number, customer_id, tanggal, taxable_amount, tax_amount, total, paid, outstanding, status, raw)
SELECT * FROM (VALUES
  (9100000001, 'FPT-INV-01', 9100000001, date_trunc('month', current_date)::date,                              10000000::numeric, 1100000::numeric, 11100000::numeric, 0::numeric, 11100000::numeric, 'OPEN', '{}'::jsonb),
  (9100000002, 'FPT-INV-02', 9100000001, current_date - 5,                                                      5000000, 550000, 5550000, 0, 5550000, 'OPEN', '{}'),
  (9100000003, 'FPT-INV-03', 9100000001, (date_trunc('month', current_date) - interval '2 months')::date + 9,   7500000, 825000, 8325000, 0, 8325000, 'OPEN', '{}'),
  (9100000004, 'FPT-INV-04', 9100000001, (current_date - interval '4 months')::date,                            2000000, 220000, 2220000, 0, 2220000, 'OPEN', '{}'),
  (9100000005, 'FPT-INV-05', 9100000001, (current_date - interval '4 months')::date - 1,                        2000000, 220000, 2220000, 0, 2220000, 'OPEN', '{}'),
  (9100000006, 'FPT-INV-06', 9100000002, current_date - 3,                                                      3000000, 330000, 3330000, 0, 3330000, 'OPEN', '{"customer":{"name":"RS FPT NAMA DARI RAW INVOICE"}}'),
  (9100000007, 'FPT-INV-07', 9100000003, current_date - 7,                                                      4000000, 440000, 4440000, 0, 4440000, 'OPEN', '{}'),
  (9100000008, 'FPT-INV-08', 9100000004, current_date - 2,                                                      1000000, 110000, 1110000, 0, 1110000, 'OPEN', '{}'),
  (9100000009, 'FPT-INV-09', 9100000001, current_date - 1,                              9999999999999.99, 1099999999999.99, 11099999999999.98, 0, 11099999999999.98, 'OPEN', '{}'),
  (9100000010, 'FPT-INV-10', 9100000001, current_date - 1,                                                         9, 1, 10, 0, 10, 'OPEN', '{}'),
  (9100000011, 'FPT-INV-11', 9100000001, current_date - 4,                                                   6000000, 0, 6000000, 0, 6000000, 'OPEN', '{}'),
  (9100000012, 'FPT-INV-12', 9100000001, current_date - 4,                                                   6000000, NULL, 6000000, 0, 6000000, 'OPEN', '{}'),
  (9100000013, 'FPT-INV-13', 9100000001, NULL,                                                               6000000, 660000, 6660000, 0, 6660000, 'OPEN', '{}'),
  -- dipakai FP seeded
  (9100000020, 'FPT-INV-20', 9100000001, (date_trunc('month', current_date) - interval '2 months')::date + 4,   8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000021, 'FPT-INV-21', 9100000001, current_date - 10,                                                     8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000022, 'FPT-INV-22', 9100000001, current_date - 9,                                                      8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000023, 'FPT-INV-23', 9100000001, current_date - 20,                                                     8000000, 880000, 8880000, 8880000, 0, 'PAID', '{}'),
  (9100000024, 'FPT-INV-24', 9100000001, current_date - 8,                                                      8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000025, 'FPT-INV-25', 9100000001, '2025-12-31',                                                          8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000026, 'FPT-INV-26', 9100000001, current_date - 6,                                                      8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}'),
  (9100000027, 'FPT-INV-27', 9100000001, current_date - 6,                                                      8000000, 880000, 8880000, 0, 8880000, 'OPEN', '{}')
) v(id, number, customer_id, tanggal, taxable_amount, tax_amount, total, paid, outstanding, status, raw);

-- ── FP SEEDED (satu per status + kasus tepi) ─────────────────────────────────
--   20 diminta, TERLAMBAT                 (invoice 2 bulan lalu → batas lewat)
--   21 diinput_coretax                    (siap diuji "Setujui": isi nomor FP)
--   22 disetujui, nomor 0100002600000099  (siap diuji "Selesaikan": isi bukti; nomor ini dipakai uji NOMOR DOBEL)
--   23 selesai (final)                    → tombol aksi tidak muncul; API tolak semua perpindahan (409)
--   24 dibatalkan, nomor 0100002600000098 → invoice 24 MUNCUL LAGI sebagai kandidat; nomor 98 boleh dipakai FP lain
--   25 masa pajak Desember 2025, diminta  → batas 15 Jan 2026 (lintas tahun), terlambat
--   26 diinput_coretax tanpa NPWP         → uji ubah NPWP (PATCH) lalu setujui
--   27 diminta, PATCH catatan/NPWP boleh  → setelah disetujui PATCH ditolak (409)
INSERT INTO faktur_pajak (invoice_id, invoice_number, customer_id, customer_name, customer_npwp, tanggal_invoice, dpp, ppn,
                          masa_pajak, batas_terbit, status, nomor_fp, bukti_url, catatan, requested_by, created_at)
SELECT i.id, i.number, i.customer_id, 'RS FPT UJI SEJAHTERA',
       CASE WHEN i.id = 9100000026 THEN NULL ELSE '01.234.567.8-901.000' END,
       i.tanggal, i.taxable_amount, i.tax_amount,
       to_char(i.tanggal, 'YYYY-MM'),
       (date_trunc('month', i.tanggal) + interval '1 month' + interval '14 days')::date,
       s.status, s.nomor, s.bukti, s.catatan, 'seed-qa', now() - interval '1 day'
FROM accurate_invoice i
JOIN (VALUES
  (9100000020, 'diminta',         NULL::text,         NULL::text,                                'Seed: terlambat'),
  (9100000021, 'diinput_coretax', NULL,               NULL,                                      'Seed: siap disetujui'),
  (9100000022, 'disetujui',       '0100002600000099', NULL,                                      'Seed: siap diselesaikan'),
  (9100000023, 'selesai',         '0100002600000090', 'https://drive.google.com/file/d/seed-bukti', 'Seed: final'),
  (9100000024, 'dibatalkan',      '0100002600000098', NULL,                                      'Seed: dibatalkan (alasan di riwayat)'),
  (9100000025, 'diminta',         NULL,               NULL,                                      'Seed: masa Desember lintas tahun'),
  (9100000026, 'diinput_coretax', NULL,               NULL,                                      'Seed: NPWP kosong'),
  (9100000027, 'diminta',         NULL,               NULL,                                      'Seed: boleh diubah')
) s(invoice_id, status, nomor, bukti, catatan) ON s.invoice_id = i.id;

-- Riwayat event minimal konsisten dengan status akhir.
INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh, catatan)
SELECT f.id, NULL, 'diminta', 'seed-qa', f.catatan FROM faktur_pajak f WHERE f.invoice_id >= 9100000000;
INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh)
SELECT f.id, 'diminta', 'diinput_coretax', 'seed-qa' FROM faktur_pajak f
 WHERE f.invoice_id >= 9100000000 AND f.status IN ('diinput_coretax','disetujui','selesai');
INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh)
SELECT f.id, 'diinput_coretax', 'disetujui', 'seed-qa' FROM faktur_pajak f
 WHERE f.invoice_id >= 9100000000 AND f.status IN ('disetujui','selesai');
INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh)
SELECT f.id, 'disetujui', 'selesai', 'seed-qa' FROM faktur_pajak f WHERE f.invoice_id >= 9100000000 AND f.status = 'selesai';
INSERT INTO faktur_pajak_event (fp_id, dari, ke, oleh, catatan)
SELECT f.id, 'diminta', 'dibatalkan', 'seed-qa', 'Seed: invoice diretur sebagian' FROM faktur_pajak f WHERE f.invoice_id >= 9100000000 AND f.status = 'dibatalkan';
