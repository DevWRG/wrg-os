-- seed-insentif-ops-dev.sql — data SINTETIS insentif, dana ops, tender LPSE, dan
-- resume monitor (dev/demo, BUKAN prod). Mengisi menu: /insentif/tim, /dana-ops,
-- /lpse-tender, /monitor/resume.
--
-- Nilai enum yang WAJIB dipatuhi:
--   insentif_am_config.tier_ut  OSP|P0|P1|P2|P3|C1|C2|C3
--   insentif_bulanan.status     draft|submitted|hod_review|finance_verify|
--                               corsec_compile|direktur_approve|paid|rejected
--                               (effort_score & presales_score 0..100)
--   insentif_transaksi          ncr_type existing|newMurni|reaktivasi · lead_type A|B|C
--   dana_ops.status             in_progress|realized
--   lpse_tender.platform        lpse|e_catalog · status pesan_masuk|barang_dikirim|selesai
--   periode insentif = char(7) 'YYYY-MM' → dipakai BULAN BERJALAN supaya halaman
--   /insentif/tim (yang mencari rekap bulan ini) tidak kosong saat direseed.

BEGIN;

-- ── Konfigurasi tier & cap per AM ──
INSERT INTO insentif_am_config (am_id, tier_ut, cap_bulanan, effective_from, updated_by) VALUES
  ('demo1', 'P1', 25000000, date_trunc('year', CURRENT_DATE)::date, 'Akun Demo'),
  ('demo2', 'P2', 18000000, date_trunc('year', CURRENT_DATE)::date, 'Akun Demo'),
  ('demo3', 'C1', 12000000, date_trunc('year', CURRENT_DATE)::date, 'Akun Demo')
ON CONFLICT (am_id) DO NOTHING;

-- ── Transaksi insentif bulan berjalan ──
INSERT INTO insentif_transaksi (id, am_id, periode, invoice_no, customer_id, tanggal, revenue, is_kso, is_ecat_pl,
                                gp_actual_pct, gp_target_pct, aging_days, ncr_type, lead_type, lead_set_by,
                                pi_points, harga_poin, mr_pct, ncr_pct, cf, pengali, insentif_raw, insentif_am, insentif_ho) VALUES
  (900001, 'demo1', to_char(CURRENT_DATE,'YYYY-MM'), 'INV-DEMO-0011', '900001', CURRENT_DATE,      166500000, FALSE, FALSE, 0.28, 0.25, 12, 'existing',   'A', 'Akun Demo', 16.5, 250000, 0.03, 0.02, 1.05, 1.10, 4537500, 3175000, 1362500),
  (900002, 'demo2', to_char(CURRENT_DATE,'YYYY-MM'), 'INV-DEMO-0012', '900002', CURRENT_DATE,       26220000, FALSE, TRUE,  0.22, 0.25,  5, 'newMurni',   'B', 'Akun Demo',  2.6, 250000, 0.03, 0.05, 1.00, 1.25,  812500,  568750,  243750),
  (900003, 'demo3', to_char(CURRENT_DATE,'YYYY-MM'), 'INV-DEMO-0013', '900003', CURRENT_DATE - 1,    3570000, TRUE,  FALSE, 0.31, 0.25, 20, 'reaktivasi', 'C', 'Akun Demo',  0.4, 250000, 0.02, 0.04, 1.00, 1.15,  115000,   80500,   34500)
ON CONFLICT (invoice_no, am_id) DO NOTHING;

-- ── Rekap bulanan per AM (satu per tahap approval supaya alurnya kelihatan) ──
INSERT INTO insentif_bulanan (id, am_id, periode, tier_ut, effort_score, presales_score, total_insentif_am,
                              total_insentif_ho, cap_bulanan, dibayar, retention_pool, status) VALUES
  (900001, 'demo1', to_char(CURRENT_DATE,'YYYY-MM'), 'P1', 82, 75, 3175000, 1362500, 25000000,       0,  317500, 'hod_review'),
  (900002, 'demo2', to_char(CURRENT_DATE,'YYYY-MM'), 'P2', 68, 60,  568750,  243750, 18000000,       0,   56875, 'finance_verify'),
  (900003, 'demo3', to_char(CURRENT_DATE,'YYYY-MM'), 'C1', 55, 48,   80500,   34500, 12000000,       0,    8050, 'draft')
ON CONFLICT (am_id, periode) DO NOTHING;

-- ── Dana operasional ──
INSERT INTO dana_ops (id, cabang, requested_by, purpose, amount_requested, request_date, status, notes, realized_at, created_by) VALUES
  ('90000000-0000-0000-0000-000000310001', 'SURABAYA', 'Andi Pratama Demo',  'Perjalanan dinas Sidoarjo–Gresik (3 hari)', 2500000, CURRENT_DATE - 12, 'realized',    NULL,                          now() - interval '7 days', 'Akun Demo'),
  ('90000000-0000-0000-0000-000000310002', 'MALANG',   'Bunga Lestari Demo', 'Instalasi & training RS Demo Husada',       1800000, CURRENT_DATE - 5,  'in_progress', 'Menunggu nota pendukung',     NULL,                      'Akun Demo'),
  ('90000000-0000-0000-0000-000000310003', 'SURABAYA', 'Galih Ramadhan Demo','Servis darurat analyzer (tol + BBM)',        750000, CURRENT_DATE - 1,  'in_progress', NULL,                          NULL,                      'Akun Demo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dana_ops_item (id, dana_ops_id, description, amount, receipt_date, notes) VALUES
  ('90000000-0000-0000-0000-000000320001', '90000000-0000-0000-0000-000000310001', 'BBM + tol',        850000, CURRENT_DATE - 11, NULL),
  ('90000000-0000-0000-0000-000000320002', '90000000-0000-0000-0000-000000310001', 'Penginapan 2 malam',1200000,CURRENT_DATE - 10, NULL),
  ('90000000-0000-0000-0000-000000320003', '90000000-0000-0000-0000-000000310001', 'Makan & lain-lain', 380000, CURRENT_DATE - 9,  'Sisa dikembalikan'),
  ('90000000-0000-0000-0000-000000320004', '90000000-0000-0000-0000-000000310002', 'BBM Surabaya–Malang',420000,CURRENT_DATE - 4,  NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Tender LPSE / e-Catalog (satu per status) ──
INSERT INTO lpse_tender (id, tender_no, judul, instansi, platform, dept, status, pesan_masuk_at, barang_dikirim_at, selesai_at, notes) VALUES
  ('90000000-0000-0000-0000-000000330001', 'TD-DEMO-001', 'Pengadaan Reagen Hematologi TA 2026', 'RSUD Demo Sehat',      'lpse',      'penawaran', 'selesai',        now() - interval '30 days', now() - interval '18 days', now() - interval '10 days', 'Pembayaran sudah masuk'),
  ('90000000-0000-0000-0000-000000330002', 'TD-DEMO-002', 'Belanja Alat Laboratorium',           'Dinkes Kota Demo',     'e_catalog', 'penawaran', 'barang_dikirim', now() - interval '14 days', now() - interval '3 days',  NULL,                       'Menunggu BAST'),
  ('90000000-0000-0000-0000-000000330003', 'TD-DEMO-003', 'Reagen Kimia Klinik Paket B',         'RS Islam Demo Husada', 'lpse',      'sales',     'pesan_masuk',    now() - interval '2 days',  NULL,                       NULL,                       'Sedang disiapkan dokumen penawaran')
ON CONFLICT (id) DO NOTHING;

-- ── Resume monitor: isi harus berstruktur 8 seksi bernomor ──
-- ResumeView mem-PARSE isi: seksi dikenali dari pola '^[1-8][.)] JUDUL' dan butir
-- dari '^[-•*] '. Kalau isinya cuma satu kalimat, activeSection/activeMeta kosong
-- → halaman menampilkan EmptyState "Tidak ada resume" walau datanya ADA.
-- Seksi 4 memakai penanda fase 'terkonfirmasi' / 'outstanding'.
UPDATE monitor_digest SET content =
'RESUME EKSEKUTIF WRG (DEMO)

1. SITUASI UMUM
- Aktivitas grup normal, 3 AM melapor tepat waktu.
- Tak ada eskalasi kritis dari cabang.

2. PIPELINE & SALES UPDATE
- RS Umum Daerah Demo Sehat | analyzer 5-diff | tahap negosiasi harga
- Klinik Pratama Demo Jaya | reagen rutin | menunggu PO

3. ACTION ITEMS OUTSTANDING
- Kirim revisi penawaran ke RS Islam Demo Husada (PIC: Bunga)
- Follow up BAST e-Catalog Dinkes Kota Demo (PIC: Andi)

4. KONFIRMASI TRACKING
terkonfirmasi
- SJ-DEMO-0101 diterima RSUD Demo Sehat, BAST lengkap
outstanding
- SJ-DEMO-0103 masih di jalan menuju Klinik Pratama Demo Jaya

5. KENDALA & ISU OPERASIONAL
- Mikropipet PO-DEMO-2602 mundur dari ETA, vendor belum konfirmasi tanggal baru.
- Toner printer lab Malang tersisa 4 unit, di bawah ambang minimum.

6. KEPUTUSAN YANG SUDAH DIAMBIL
- Relokasi 3 jerigen diluent dari Surabaya ke Malang disetujui.

7. UNTUK DIBAHAS DENGAN DIREKTUR
- Perpanjangan MOU KSO Klinik Pratama Demo Jaya jatuh tempo 4 bulan lagi.

8. UNTUK HOD
- Rocky: pastikan revisi penawaran RS Islam terkirim pekan ini.
- Yogi: cek kesiapan ruang lab sebelum instalasi Blood Gas Analyzer.'
WHERE kind = 'resume';

COMMIT;

\echo 'Seed insentif/dana-ops/LPSE/resume selesai: 3 config + 3 transaksi + 3 rekap insentif, 3 dana ops + 4 item, 3 tender, resume berstruktur 8 seksi.'
