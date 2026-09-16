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

-- ── #PRICING / #SPH: butuh product_pricelist ──
-- Data price book NYATA tak boleh masuk repo (repo publik, lihat F142), dan
-- seed-dev-full.sql pun tak mengisi tabel ini. Tanpa fixture di bawah, dua
-- skenario #SPH gagal di DB baru dan #PRICING lolos SEMU ("tidak ada produk
-- cocok" tetap dianggap balasan sah). Jadi produk di bawah SENGAJA rekaan —
-- nama diawali "QA " supaya tak pernah tertukar dengan katalog betulan, dan
-- angkanya bulat asal-asalan, bukan harga sungguhan.
--
-- row_no 900001+ menghindari bentrok UNIQUE (periode, row_no) dengan hasil
-- import nyata. `lini` wajib 'IVD' atau 'Medical' (CHECK constraint).
--
-- Tiga baris, masing-masing ada gunanya:
--   QA-PL-001  diskon_maks 10%  → #SPH diskon 5% HARUS lolos
--   QA-PL-002  diskon_maks 20%  → hasil kedua #PRICING (buktikan >1 baris)
--   QA-PL-900  diskon_maks 0%   → #SPH diskon 5% HARUS ditolak plafon
INSERT INTO product_pricelist
  (periode, row_no, kode, lini, brand, nama, varian, kemasan, price_list, diskon_maks, harga_nett, nett_ppn)
VALUES
  ('H2-2026', 900001, 'QA-PL-001', 'IVD', 'QA Brand', 'QA Reagen Kontrol Fixture', 'Pack', 'Box', 1000000, 0.10, 900000, 999000),
  ('H2-2026', 900002, 'QA-PL-002', 'IVD', 'QA Brand', 'QA Reagen Strip Fixture', NULL, 'Box', 500000, 0.20, 400000, 444000),
  ('H2-2026', 900900, 'QA-PL-900', 'Medical', 'QA Brand', 'QA Alat Tanpa Diskon Fixture', NULL, 'Unit', 2000000, 0.00, 2000000, 2220000)
ON CONFLICT (periode, row_no) DO UPDATE SET
  kode = EXCLUDED.kode, nama = EXCLUDED.nama, price_list = EXCLUDED.price_list,
  diskon_maks = EXCLUDED.diskon_maks, harga_nett = EXCLUDED.harga_nett, nett_ppn = EXCLUDED.nett_ppn;

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

-- ── #CEK (F4/QW3) butuh SO & SJ — dua tabel ini sebelumnya TAK PERNAH diisi ──
-- Tanpa fixture, dua skenario #CEK cuma bisa memakai ekspektasi /.+/ ("asal ada
-- balasan"), sehingga balasan "tidak ditemukan di data SO/SJ" ikut dianggap
-- lulus. Itu lolos semu — pola yang sudah didokumentasikan di file ini untuk
-- #PRICING, tapi #CEK belum kebagian (#1043).
--
-- ⚠️ NAMA CUSTOMER SENGAJA BERJAUHAN SECARA TRIGRAM.
-- Kalau nama antar-kasus mirip, kasus "cuma punya SO" bisa menarik SJ milik
-- kasus lain — dan baris "Belum ada SJ tercatat" tak akan pernah muncul. Dua
-- kasus itu saling meniadakan, dan gejalanya bukan error, cuma hasil yang
-- kelihatan wajar. Terukur di wrg_os_dev: kemiripan antar-ketiganya 0,091-0,100,
-- dan terhadap 44 baris SO/SJ nyata yang sudah ada maksimum 0,069 — semuanya
-- jauh di bawah ambang. Kalau menambah kasus baru, UKUR DULU dengan
-- similarity(). Sejak perbaikan #839 kemiripan nama TIDAK LAGI bisa membuat
-- satu kasus mencuri dokumen kasus lain (identitas customer di-resolve sekali
-- di depan, lalu SO & SJ diambil per `customer_id`) — tapi nama yang mirip
-- sekarang memicu balasan AMBIGU, yang sama-sama menggagalkan ekspektasi tes.
--
-- Baris `accurate_customer` di bawah bukan pelengkap: itu yang di-resolve
-- DULUAN oleh handleCekQuery(). Tanpanya fixture cuma menguji jalur fallback,
-- dan hasilnya bisa tergantung isi mirror customer sungguhan di DB itu.
--
-- Tanggal dipatok tetap (bukan now()) supaya korelasi ±14 hari di cek.ts
-- deterministik: SO 2026-03-10 dan SJ 2026-03-12 selalu berjarak 2 hari.

-- Kasus 4/5 (QA KEMBAR ALFA/BETA) justru SENGAJA mirip — dua-duanya diukur di
-- wrg_os_dev: satu sama lain 0,500 dan terhadap query "QA KEMBAR" 0,667/0,667,
-- sementara terhadap tiga nama di atas maksimum 0,148 (jauh di bawah ambang
-- CEK_MATCH 0,45, jadi tak mengganggu kasus 1-3).
INSERT INTO accurate_customer (id, no, name) VALUES
  (900001, 'C-QA-9001', 'QA MAWAR SEJAHTERA'),
  (900002, 'C-QA-9002', 'QA BAKTI HUSADA'),
  (900003, 'C-QA-9003', 'QA CENDANA PRIMA'),
  (900004, 'C-QA-9004', 'QA KEMBAR ALFA'),
  (900005, 'C-QA-9005', 'QA KEMBAR BETA')
ON CONFLICT (id) DO UPDATE SET no = EXCLUDED.no, name = EXCLUDED.name;

-- Kasus 1 — punya SO DAN SJ (balasan lengkap, dua-duanya terisi).
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, customer_id, status, total_amount)
VALUES (900001, 'SO-QA-9001', DATE '2026-03-10', 'QA MAWAR SEJAHTERA', 900001, 'Pending', 12500000)
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  status = EXCLUDED.status, total_amount = EXCLUDED.total_amount;

INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, customer_id, ship_to, status)
VALUES (900001, 'SJ-QA-9001', DATE '2026-03-12', 'QA MAWAR SEJAHTERA', 900001, 'Jl. Fixture 1', 'Delivered')
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  ship_to = EXCLUDED.ship_to, status = EXCLUDED.status;

-- Kasus 2 — HANYA SO. Membuktikan baris "Belum ada SJ tercatat" benar muncul.
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, customer_id, status, total_amount)
VALUES (900002, 'SO-QA-9002', DATE '2026-03-10', 'QA BAKTI HUSADA', 900002, 'Pending', 4750000)
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  status = EXCLUDED.status, total_amount = EXCLUDED.total_amount;

-- Kasus 3 — HANYA SJ. Membuktikan baris "Belum ada SO tercatat" benar muncul.
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, customer_id, ship_to, status)
VALUES (900003, 'SJ-QA-9003', DATE '2026-03-11', 'QA CENDANA PRIMA', 900003, 'Jl. Fixture 3', 'Delivered')
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  ship_to = EXCLUDED.ship_to, status = EXCLUDED.status;

-- Kasus 4/5 — dua customer BEDA bernama mirip, satu punya SO saja dan satunya
-- SJ saja. Regresi #839: dulu balasan untuk "QA KEMBAR BETA" ikut membawa SO
-- milik "QA KEMBAR ALFA" — dokumen customer lain terkirim ke pengirim yang
-- salah. Sekaligus fixture balasan AMBIGU untuk query "QA KEMBAR".
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, customer_id, status, total_amount)
VALUES (900004, 'SO-QA-9004', DATE '2026-03-10', 'QA KEMBAR ALFA', 900004, 'Pending', 3300000)
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  status = EXCLUDED.status, total_amount = EXCLUDED.total_amount;

INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, customer_id, ship_to, status)
VALUES (900005, 'SJ-QA-9005', DATE '2026-03-11', 'QA KEMBAR BETA', 900005, 'Jl. Fixture 5', 'Delivered')
ON CONFLICT (id) DO UPDATE SET
  number = EXCLUDED.number, trans_date = EXCLUDED.trans_date,
  customer_name = EXCLUDED.customer_name, customer_id = EXCLUDED.customer_id,
  ship_to = EXCLUDED.ship_to, status = EXCLUDED.status;
