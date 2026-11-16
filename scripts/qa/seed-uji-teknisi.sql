-- Data dummy uji fitur Teknisi (F175 #PLAN/#START/#REPORT + efek Aftersales) — HANYA untuk wrg_os_dev.
--
--   psql -d wrg_os_dev -v ON_ERROR_STOP=1 -f scripts/qa/seed-uji-teknisi.sql
--   (bersihkan: scripts/qa/bersih-uji-teknisi.sql)
--
-- Idempoten (boleh dijalankan ulang; tiap run menyegarkan tiket/jadwal ke keadaan awal uji).
-- Semua baris bertanda UJIF175 (nama faskes, SN, teks) supaya mudah dikenali & dihapus.
-- Menolak jalan di database selain wrg_os_dev.
--
-- Isi:
--   Teknisi  UJI-TEKNISI-F175 ("[UJI] Teknisi F175", role Teknisi) — dibuat bila belum ada.
--   Faskes A "UJIF175 ALFA, RS KOTA MALANG"   (ketik: RS Ujif175 Alfa)
--     · alat KSO  UJ75A101  Uji Analyzer Hematologi  → PM   (jadwal rutin bulan ini menunggu alat ini)
--     · alat KSO  UJ75A202  Uji Analyzer Kimia       → Service (ada 1 tiket servis terbuka di faskes ini)
--   Faskes B "UJIF175 BETA, RSUD KAB. KEDIRI"   (ketik: RSUD Ujif175 Beta)
--     · alat beli UJ75B303  Uji Centrifuge F175      → Install (jadwal install 'scheduled') & PM (maintenance jatuh tempo)

DO $$
BEGIN
  IF current_database() <> 'wrg_os_dev' THEN
    RAISE EXCEPTION 'seed-uji-teknisi hanya untuk wrg_os_dev (sekarang: %)', current_database();
  END IF;
END $$;

BEGIN;

-- Teknisi uji (trigger 246 menyalin ke teknisi_capacity).
INSERT INTO master_user (am_id, nama, panggilan, role, cabang, aktif, wajib_plan_report)
VALUES ('UJI-TEKNISI-F175', '[UJI] Teknisi F175', 'Teknisi F175', 'Teknisi', 'PUSAT', true, false)
ON CONFLICT (am_id) DO NOTHING;

-- Faskes (id jauh di atas id Accurate asli).
INSERT INTO accurate_customer (id, no, name, last_synced_at) VALUES
  (990001751, 'UJIF175-A', 'UJIF175 ALFA, RS KOTA MALANG', now()),
  (990001752, 'UJIF175-B', 'UJIF175 BETA, RSUD KAB. KEDIRI', now())
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, no = EXCLUDED.no;

-- Alat KSO (SN unik berhuruf supaya potongan SN tak bertabrakan dengan alat asli).
INSERT INTO kso_asset (sn_key, sn_raw, customer_raw, account_id, kota, type_alat, nama_alat, skema, pemilik_alat, aktif, keterangan)
VALUES
  ('UJ75A101', 'UJ75A101', 'UJIF175 ALFA, RS KOTA MALANG', 990001751, 'MALANG', 'UJI-HEMA', 'Uji Analyzer Hematologi', 'PER_TEST', 'WRG', true, 'UJIF175 data uji'),
  ('UJ75A202', 'UJ75A202', 'UJIF175 ALFA, RS KOTA MALANG', 990001751, 'MALANG', 'UJI-KIMIA', 'Uji Analyzer Kimia', 'PER_TEST', 'WRG', true, 'UJIF175 data uji')
ON CONFLICT (sn_key) DO UPDATE SET account_id = EXCLUDED.account_id, aktif = true, nama_alat = EXCLUDED.nama_alat;

-- Alat beli + jadwal install + maintenance (modul Aftersales).
INSERT INTO installation_unit (id, alat_name, serial_number, customer_name, account_id, cabang, status, created_by)
VALUES ('f1750000-0000-4000-8000-000000000b03', 'Uji Centrifuge F175', 'UJ75B303', 'UJIF175 BETA, RSUD KAB. KEDIRI',
        990001752, 'KEDIRI', 'teknisi_assign', 'UJIF175 seed')
ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, serial_number = EXCLUDED.serial_number;

INSERT INTO install_schedule (id, installation_unit_id, scheduled_date, status, note)
VALUES ('f1750000-0000-4000-8000-0000000005c1', 'f1750000-0000-4000-8000-000000000b03',
        (now() AT TIME ZONE 'Asia/Jakarta')::date, 'scheduled', 'UJIF175 data uji')
ON CONFLICT (id) DO UPDATE SET status = 'scheduled', scheduled_date = EXCLUDED.scheduled_date;

INSERT INTO maintenance_schedule (installation_unit_id, interval_bulan, reference_date, due_date, status, last_note, completed_count)
VALUES ('f1750000-0000-4000-8000-000000000b03', 6,
        ((now() AT TIME ZONE 'Asia/Jakarta')::date - interval '6 months')::date,
        (now() AT TIME ZONE 'Asia/Jakarta')::date, 'scheduled', 'UJIF175 data uji', 0)
ON CONFLICT (installation_unit_id) DO UPDATE SET
  reference_date = EXCLUDED.reference_date, due_date = EXCLUDED.due_date, status = 'scheduled',
  last_completed_at = NULL, last_note = EXCLUDED.last_note, completed_count = 0;

-- Tiket servis terbuka di Faskes A, masuk 2 jam lalu (SLA: tiket → #START → #REPORT).
INSERT INTO service_ticket (id, source, customer_name, customer_id, complaint_text, severity, needs_review, status, created_at, updated_at)
VALUES ('f1750000-0000-4000-8000-0000000071c7', 'manual', 'UJIF175 ALFA, RS KOTA MALANG', 990001751,
        'UJIF175 data uji — analyzer kimia error saat kalibrasi', 'sedang', false, 'open',
        now() - interval '2 hours', now() - interval '2 hours')
ON CONFLICT (id) DO UPDATE SET status = 'open', resolved_at = NULL, resolved_note = NULL,
  created_at = now() - interval '2 hours', updated_at = now();

-- Jadwal rutin bulan ini untuk Faskes A, menunggu PM alat UJ75A101.
INSERT INTO jadwal_rutin_bulan (bulan, status) VALUES (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')::date, 'draft')
ON CONFLICT (bulan) DO NOTHING;
DELETE FROM jadwal_rutin WHERE account_id = 990001751;
INSERT INTO jadwal_rutin (bulan, tanggal, urutan, teknisi_id, account_id, wilayah, alat, status, sumber, catatan)
VALUES (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')::date, (now() AT TIME ZONE 'Asia/Jakarta')::date, 1,
        'UJI-TEKNISI-F175', 990001751, 'MALANG',
        '[{"sn": "UJ75A101", "nama": "Uji Analyzer Hematologi", "skema": "PER_TEST"}]'::jsonb,
        'rencana', 'manual', 'UJIF175 data uji');

-- Tugaskan semua jadwal uji ke teknisi uji (menu Kinerja Teknisi → Jadwal). ETA tiket 4 jam sejak masuk
-- (= 2 jam lagi) → laporkan dalam 2 jam = tepat ETA; lewat dari itu = "lewat ETA".
UPDATE maintenance_schedule SET teknisi_id = (SELECT id FROM teknisi_capacity WHERE am_id = 'UJI-TEKNISI-F175'),
       teknisi_name = '[UJI] Teknisi F175'
 WHERE installation_unit_id = 'f1750000-0000-4000-8000-000000000b03';
UPDATE install_schedule SET teknisi_id = (SELECT id FROM teknisi_capacity WHERE am_id = 'UJI-TEKNISI-F175')
 WHERE id = 'f1750000-0000-4000-8000-0000000005c1';
UPDATE service_ticket SET assigned_teknisi_id = (SELECT id FROM teknisi_capacity WHERE am_id = 'UJI-TEKNISI-F175'),
       assigned_teknisi_name = '[UJI] Teknisi F175', eta_at = created_at + interval '4 hours'
 WHERE id = 'f1750000-0000-4000-8000-0000000071c7';

-- Mulai bersih: plan/report uji hari-hari sebelumnya untuk dua faskes ini dihapus.
DELETE FROM teknisi_kunjungan WHERE account_id IN (990001751, 990001752) OR faskes_teks ILIKE '%ujif175%';
DELETE FROM teknisi_plan_item WHERE account_id IN (990001751, 990001752) OR faskes_teks ILIKE '%ujif175%';

COMMIT;

SELECT 'faskes' AS jenis, name AS isi FROM accurate_customer WHERE id IN (990001751, 990001752)
UNION ALL SELECT 'alat KSO', sn_raw || ' · ' || nama_alat FROM kso_asset WHERE sn_key IN ('UJ75A101', 'UJ75A202')
UNION ALL SELECT 'alat beli', serial_number || ' · ' || alat_name FROM installation_unit WHERE id = 'f1750000-0000-4000-8000-000000000b03'
UNION ALL SELECT 'tiket', status || ' · ' || complaint_text FROM service_ticket WHERE id = 'f1750000-0000-4000-8000-0000000071c7'
UNION ALL SELECT 'jadwal rutin', status || ' · ' || tanggal::text FROM jadwal_rutin WHERE account_id = 990001751
UNION ALL SELECT 'install', status || ' · ' || scheduled_date::text FROM install_schedule WHERE id = 'f1750000-0000-4000-8000-0000000005c1'
UNION ALL SELECT 'maintenance', status || ' · jatuh tempo ' || due_date::text FROM maintenance_schedule WHERE installation_unit_id = 'f1750000-0000-4000-8000-000000000b03';
