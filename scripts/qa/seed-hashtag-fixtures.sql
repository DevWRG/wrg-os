-- Fixture untuk simulasi command hashtag WA (scripts/qa/sim-hashtag.mjs).
-- Idempoten — aman dijalankan berulang. JANGAN dijalankan di prod.
--
-- Semua identitas fixture berdiri SENDIRI (am_id 'QA-*', email '*@qa.invalid',
-- SJ 'SJ-QA-*', APR-90xx) supaya tak pernah menyentuh baris roster/transaksi
-- nyata. Nomor WA pakai 62811100000x — bukan nomor yang bisa dihubungi.

-- ── Pengirim: AM dikenal (gerbang resolveSender Tier B = wa_number) ──
INSERT INTO master_user (am_id, nama, panggilan, wa_number, role, cabang, aktif)
VALUES ('QA-AM-1', 'Dewi Fixture', 'Dewi', '628111000001', 'AM', 'KEDIRI', true)
ON CONFLICT (am_id) DO UPDATE SET
  nama = EXCLUDED.nama, wa_number = EXCLUDED.wa_number,
  role = EXCLUDED.role, cabang = EXCLUDED.cabang, aktif = true;

-- ── Pengirim: HoD approver (gerbang resolveApprover = app_user.wa_number) ──
-- password_hash dummy: akun ini tak pernah dipakai login, cuma identitas WA.
INSERT INTO app_user (email, password_hash, name, role, wa_number, hod_key, active)
VALUES ('hod@qa.invalid', 'bukan-akun-login', 'Rina Fixture', 'hod', '628111000002', 'qa-hod', true)
ON CONFLICT (email) DO UPDATE SET
  wa_number = EXCLUDED.wa_number, hod_key = EXCLUDED.hod_key,
  name = EXCLUDED.name, role = EXCLUDED.role, active = true;

-- ── Pengirim: teknisi (gerbang matchTeknisiByName = pushname ILIKE nama) ──
INSERT INTO teknisi_capacity (nama, wa_number, aktif)
SELECT 'Joko Fixture', '628111000003', true
WHERE NOT EXISTS (SELECT 1 FROM teknisi_capacity WHERE nama = 'Joko Fixture');

-- ── #STOK butuh gudang cabang yang cocok dgn cabang AM di atas ──
INSERT INTO warehouse (kode, nama, cabang, jenis, aktif)
VALUES ('KEDIRI', 'Gudang Kediri', 'Kediri', 'cabang', true)
ON CONFLICT (kode) DO NOTHING;

-- Stok cabang untuk SATU item, dipilih deterministik (item ber-`no` terkecil)
-- supaya tak bergantung pada katalog Accurate tertentu. Harness membaca item
-- mana yang terpakai lewat query, bukan menebak namanya.
INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source)
SELECT ai.id, 'KEDIRI', 40, 'manual'
FROM accurate_item ai ORDER BY ai.no LIMIT 1
ON CONFLICT (item_id, warehouse_kode) DO UPDATE SET quantity = 40, source = 'manual';

-- ── #KIRIM / #BAST / #BUKTI: tiga SJ pada tahap berbeda ──
-- Status awal di-set ulang oleh harness tiap kali jalan (lihat resetState),
-- jadi di sini cukup memastikan barisnya ADA.
INSERT INTO shipment_tracking (sj_number, customer_name, cabang, status, created_by)
SELECT v.sj, v.cust, 'Kediri', 'draft', 'qa-fixture'
FROM (VALUES
  ('SJ-QA-001', 'RSUD Fixture Kediri'),
  ('SJ-QA-002', 'Klinik Fixture Kediri'),
  ('SJ-QA-003', 'Lab Fixture Kediri')
) AS v(sj, cust)
WHERE NOT EXISTS (SELECT 1 FROM shipment_tracking s WHERE s.sj_number = v.sj);

-- ── #APPROVE / #REJECT: tiga request ──
-- APR-9001 satu tahap → uji balasan "tahap terakhir"
-- APR-9002 dua tahap  → uji balasan "lanjut ke tahap berikutnya"
-- APR-9003 satu tahap → uji #REJECT
INSERT INTO approval_request (kode, title, description, requested_by, status, current_urutan)
SELECT v.kode, v.title, 'fixture uji hashtag WA', 'qa-fixture', 'pending', 1
FROM (VALUES
  ('APR-9001', 'Uji approve tahap terakhir'),
  ('APR-9002', 'Uji approve lanjut tahap'),
  ('APR-9003', 'Uji reject')
) AS v(kode, title)
WHERE NOT EXISTS (SELECT 1 FROM approval_request r WHERE r.kode = v.kode);

-- Tahap 1 untuk ketiganya. hod_key HARUS sama dgn app_user fixture di atas —
-- decideCurrentStep memvalidasi approver adalah pemegang tahap CURRENT persis.
INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key, status)
SELECT r.id, 1, 'HoD Fixture', 'hod', 'qa-hod', 'pending'
FROM approval_request r
WHERE r.kode IN ('APR-9001', 'APR-9002', 'APR-9003')
  AND NOT EXISTS (SELECT 1 FROM approval_step s WHERE s.request_id = r.id AND s.urutan = 1);

-- Tahap 2 HANYA untuk APR-9002, biar approve tahap 1 berbunyi "lanjut ke tahap
-- berikutnya" dan bukan "tahap terakhir". target direktur = tak match approver
-- fixture (role hod), itu memang disengaja: tahap 2 tak ikut diuji.
INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key, status)
SELECT r.id, 2, 'Direktur', 'direktur', NULL, 'pending'
FROM approval_request r
WHERE r.kode = 'APR-9002'
  AND NOT EXISTS (SELECT 1 FROM approval_step s WHERE s.request_id = r.id AND s.urutan = 2);
