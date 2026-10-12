-- seed-service-dev.sql — data SINTETIS modul servis & teknik (dev/demo, BUKAN prod).
-- Mengisi menu: /service-tickets, /maintenance, /installations, /readiness-board,
-- /proficiency-tests, /doc-klaim.
-- Idempoten; uuid dummy '90000000-...'; tanggal RELATIF.
-- Status mengikuti CHECK:
--   service_ticket.source manual|wa · severity rendah|sedang|tinggi|kritis · status open|resolved
--   installation_unit.status draft|po_control|sj|teknisi_assign|training|bast
--   install_schedule.status scheduled|done|cancelled
--   maintenance_schedule.status scheduled|notified (interval_bulan > 0)
--   doc_klaim.status baru|disetujui|ditolak|dibayar · kategori kebutuhan_kantor|perjalanan_dinas|lainnya

BEGIN;

-- ── Tiket servis (campur sumber manual & WA, ada yang selesai) ──
INSERT INTO service_ticket (id, source, customer_name, complaint_text, area, severity, eta_at,
                            assigned_teknisi_name, needs_review, status, resolved_at, resolved_note) VALUES
  ('90000000-0000-0000-0000-000000210001', 'wa',     'RS Umum Daerah Demo Sehat', 'Analyzer hematologi error E-12 saat running sampel pagi.', 'SURABAYA', 'kritis', now() + interval '4 hours', 'Galih Demo', FALSE, 'open',     NULL,                      NULL),
  ('90000000-0000-0000-0000-000000210002', 'manual', 'RS Islam Demo Husada',      'Printer hasil lab tidak mencetak, kabel sudah dicek.',      'SURABAYA', 'sedang', now() + interval '1 day',    'Galih Demo', FALSE, 'open',     NULL,                      NULL),
  ('90000000-0000-0000-0000-000000210003', 'wa',     'Klinik Pratama Demo Jaya',  'Hasil kontrol di luar range, minta kalibrasi ulang.',       'MALANG',   'tinggi', now() + interval '2 days',   NULL,         TRUE,  'open',     NULL,                      NULL),
  ('90000000-0000-0000-0000-000000210004', 'manual', 'RS Umum Daerah Demo Sehat', 'Ganti tubing peristaltik, sudah aus.',                      'SURABAYA', 'rendah', NULL,                        'Galih Demo', FALSE, 'resolved', now() - interval '3 days', 'Tubing diganti, running normal 20 sampel.'),
  ('90000000-0000-0000-0000-000000210005', 'wa',     'RS Islam Demo Husada',      'Alat tidak menyala setelah listrik mati.',                  'SURABAYA', 'kritis', NULL,                        'Galih Demo', FALSE, 'resolved', now() - interval '8 days', 'Fuse pengganti dipasang, edukasi UPS ke user.')
ON CONFLICT (id) DO NOTHING;

-- ── Unit instalasi (satu per tahap, supaya papan tahapan terlihat penuh) ──
INSERT INTO installation_unit (id, alat_name, serial_number, customer_name, cabang, po_number, po_control_done, po_control_at,
                               sj_number, sj_done, sj_at, teknisi_name, teknisi_assign_done, teknisi_assign_at,
                               training_notes, training_done, training_at, bast_number, bast_done, bast_at, status, created_by) VALUES
  ('90000000-0000-0000-0000-000000220001', 'Hematology Analyzer 5-diff', 'SN-DEMO-H5-001', 'RS Umum Daerah Demo Sehat', 'SURABAYA', 'PO-DEMO-2601', TRUE, now() - interval '20 days',
   'SJ-DEMO-0101', TRUE, now() - interval '8 days', 'Galih Demo', TRUE, now() - interval '7 days',
   'Training 2 analis, materi QC harian', TRUE, now() - interval '6 days', 'BAST-DEMO-001', TRUE, now() - interval '5 days', 'bast', 'Andi Demo'),
  ('90000000-0000-0000-0000-000000220002', 'Chemistry Analyzer 200T',    'SN-DEMO-C2-002', 'RS Islam Demo Husada',      'SURABAYA', 'PO-DEMO-2602', TRUE, now() - interval '14 days',
   'SJ-DEMO-0102', TRUE, now() - interval '3 days', 'Galih Demo', TRUE, now() - interval '2 days',
   NULL, FALSE, NULL, NULL, FALSE, NULL, 'training', 'Andi Demo'),
  ('90000000-0000-0000-0000-000000220003', 'Urine Analyzer UA-11',       'SN-DEMO-U1-003', 'Klinik Pratama Demo Jaya',  'MALANG',   'PO-DEMO-2603', TRUE, now() - interval '6 days',
   NULL, FALSE, NULL, NULL, FALSE, NULL, NULL, FALSE, NULL, NULL, FALSE, NULL, 'po_control', 'Bunga Demo'),
  ('90000000-0000-0000-0000-000000220004', 'Blood Gas Analyzer BG-3',    NULL,             'RS Umum Daerah Demo Sehat', 'SURABAYA', NULL,           FALSE, NULL,
   NULL, FALSE, NULL, NULL, FALSE, NULL, NULL, FALSE, NULL, NULL, FALSE, NULL, 'draft', 'Andi Demo')
ON CONFLICT (id) DO NOTHING;

-- ── Jadwal instalasi (papan kesiapan) ──
INSERT INTO install_schedule (id, installation_unit_id, scheduled_date, status, note) VALUES
  ('90000000-0000-0000-0000-000000230001', '90000000-0000-0000-0000-000000220002', CURRENT_DATE + 1, 'scheduled', 'Training analis shift pagi'),
  ('90000000-0000-0000-0000-000000230002', '90000000-0000-0000-0000-000000220003', CURRENT_DATE + 4, 'scheduled', 'Menunggu surat jalan'),
  ('90000000-0000-0000-0000-000000230003', '90000000-0000-0000-0000-000000220001', CURRENT_DATE - 6, 'done',      'Instalasi & training selesai'),
  ('90000000-0000-0000-0000-000000230004', '90000000-0000-0000-0000-000000220004', CURRENT_DATE - 2, 'cancelled', 'Ruang lab belum siap')
ON CONFLICT (id) DO NOTHING;

-- ── Jadwal maintenance / kalibrasi (satu jatuh tempo dekat, satu sudah dinotifikasi) ──
INSERT INTO maintenance_schedule (id, installation_unit_id, interval_bulan, reference_date, due_date, teknisi_name, teknisi_wa_number,
                                  status, notified_at, last_completed_at, last_note, completed_count) VALUES
  ('90000000-0000-0000-0000-000000240001', '90000000-0000-0000-0000-000000220001', 6, CURRENT_DATE - 180, CURRENT_DATE + 7,  'Galih Demo', '628000000007', 'scheduled', NULL,                      now() - interval '180 days', 'PM ke-1 selesai, semua parameter pass', 1),
  ('90000000-0000-0000-0000-000000240002', '90000000-0000-0000-0000-000000220002', 3, CURRENT_DATE - 90,  CURRENT_DATE + 2,  'Galih Demo', '628000000007', 'notified',  now() - interval '2 days', NULL,                        NULL,                                    0),
  ('90000000-0000-0000-0000-000000240003', '90000000-0000-0000-0000-000000220003', 12,CURRENT_DATE - 30,  CURRENT_DATE + 335,'Galih Demo', '628000000007', 'scheduled', NULL,                      NULL,                        NULL,                                    0)
ON CONFLICT (id) DO NOTHING;

-- ── Uji profisiensi (satu kedaluwarsa, satu mendekat) ──
INSERT INTO proficiency_test_document (id, rs_name, test_name, provider, cert_number, issued_date, expired_date, cabang, pic, notes, file_name) VALUES
  ('90000000-0000-0000-0000-000000250001', 'RS Umum Daerah Demo Sehat', 'PME Hematologi Siklus 1', 'Provider PME Demo', 'PME-DEMO-2601', CURRENT_DATE - 300, CURRENT_DATE + 60, 'SURABAYA', 'Galih Demo', NULL,                          'pme-hema-demo.pdf'),
  ('90000000-0000-0000-0000-000000250002', 'RS Islam Demo Husada',      'PME Kimia Klinik',        'Provider PME Demo', 'PME-DEMO-2602', CURRENT_DATE - 340, CURRENT_DATE + 20, 'SURABAYA', 'Galih Demo', 'Perpanjangan sedang diproses','pme-kimia-demo.pdf'),
  ('90000000-0000-0000-0000-000000250003', 'Klinik Pratama Demo Jaya',  'PME Urinalisis',          'Provider PME Demo', 'PME-DEMO-2551', CURRENT_DATE - 400, CURRENT_DATE - 30, 'MALANG',   'Bunga Demo', 'SUDAH KEDALUWARSA — perlu daftar ulang', 'pme-urin-demo.pdf')
ON CONFLICT (id) DO NOTHING;

-- ── Dokumen klaim (OCR) — satu per status ──
-- employee_id DIBIARKAN NULL: FK-nya ke tabel `employee`, yang di environment
-- demo diisi oleh migrasi 053 (data karyawan SUNGGUHAN) dan karena itu
-- di-anonimkan/di-skip saat provisioning demo. Menautkan klaim ke id nyata
-- (mis. 'angga') akan menghidupkan lagi identitas yang justru mau dibuang.
INSERT INTO doc_klaim (id, sender_name, employee_id, caption, raw_text, nomor_dokumen, tanggal_dokumen, nominal, pihak,
                       kategori, status, nominal_disetujui, dibayar_at, catatan) VALUES
  ('90000000-0000-0000-0000-000000260001', 'Andi Demo',  NULL      , 'Nota bensin kunjungan Sidoarjo', 'NOTA BBM DEMO 150.000', 'NT-DEMO-001', to_char(CURRENT_DATE - 3, 'YYYY-MM-DD'),  '150000',  'SPBU Demo',        'perjalanan_dinas', 'baru',      NULL,   NULL,                      NULL),
  ('90000000-0000-0000-0000-000000260002', 'Bunga Demo', NULL, 'Parkir & tol Malang',            'STRUK TOL DEMO 62.000','NT-DEMO-002', to_char(CURRENT_DATE - 6, 'YYYY-MM-DD'),  '62000',   'Jasa Marga Demo',  'perjalanan_dinas', 'disetujui', 62000, NULL,                      'Sesuai bukti'),
  ('90000000-0000-0000-0000-000000260003', 'Fitri Demo', NULL, 'Belanja materai & amplop',       'NOTA DEMO 85.000',     'NT-DEMO-003', to_char(CURRENT_DATE - 12, 'YYYY-MM-DD'), '85000',   'Toko Demo Jaya',   'kebutuhan_kantor', 'dibayar',   85000, now() - interval '5 days', 'Dibayar bersama reimburse Agustus'),
  ('90000000-0000-0000-0000-000000260004', 'Candra Demo',NULL      , 'Nota makan tim',                 'NOTA DEMO 480.000',    'NT-DEMO-004', to_char(CURRENT_DATE - 9, 'YYYY-MM-DD'),  '480000',  'Resto Demo',       'lainnya',          'ditolak',   NULL,   NULL,                      'Di luar kebijakan, bukan jamuan customer')
ON CONFLICT (id) DO NOTHING;

-- ── Laporan teknisi (panel kedua /readiness-board) ──
-- teknisi_id merujuk teknisi_capacity yang sudah diseed seed-dev-full.sql;
-- dicocokkan lewat nama supaya tak bergantung pada uuid yang digenerate.
INSERT INTO teknisi_report (id, teknisi_id, report_type, body, source, installation_unit_id, created_at)
SELECT v.id, tc.id, v.rtype, v.body, v.src, v.unit, v.at
FROM (VALUES
  ('90000000-0000-0000-0000-000000270001'::uuid, 'Teknisi Fajar',  'install',   'Instalasi Hematology Analyzer 5-diff selesai, semua parameter QC pass.', 'manual', '90000000-0000-0000-0000-000000220001'::uuid, now() - interval '6 days'),
  ('90000000-0000-0000-0000-000000270002'::uuid, 'Teknisi Fajar',  'training',  'Training 2 analis: QC harian, cara ganti reagen, penanganan error E-12.', 'wa',     '90000000-0000-0000-0000-000000220001'::uuid, now() - interval '6 days'),
  ('90000000-0000-0000-0000-000000270003'::uuid, 'Teknisi Gilang', 'servis',    'Ganti tubing peristaltik, running 20 sampel normal.',                    'wa',     NULL,                                        now() - interval '3 days'),
  ('90000000-0000-0000-0000-000000270004'::uuid, 'Teknisi Hesti',  'kalibrasi', 'Kalibrasi Chemistry Analyzer 200T, sertifikat menyusul dari vendor.',     'manual', '90000000-0000-0000-0000-000000220002'::uuid, now() - interval '1 day')
) AS v(id, teknisi_nama, rtype, body, src, unit, at)
JOIN teknisi_capacity tc ON tc.nama = v.teknisi_nama
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Seed servis & teknik selesai: 5 tiket, 4 unit instalasi, 4 jadwal install, 3 maintenance, 3 PME, 4 klaim, 4 laporan teknisi.'
