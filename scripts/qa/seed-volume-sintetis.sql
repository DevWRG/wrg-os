-- Volume SINTETIS untuk lingkungan uji magang / dev lokal.
--
-- Mengisi tabel mirror Accurate dengan puluhan ribu baris BUATAN supaya menu
-- yang berat (Stock Gudang, Sales Overview, Customers, Orders, Shipments,
-- Purchase Forecast) terasa realistis — TANPA menyalin satu byte pun data
-- produksi.
--
-- Kenapa tidak pakai dump prod: dump itu memuat password_hash, 63 nomor HP
-- karyawan, insentif & NPK per orang, raport HR, price book (yang sengaja tak
-- pernah di-commit karena repo ini publik), pelanggan nyata, dan percakapan WA
-- staf. Begitu ada di banyak laptop, kendalinya hilang permanen. Volume-nya
-- sendiri bisa ditiru; isinya tidak perlu.
--
-- SIFAT:
--   · DETERMINISTIK — semua nilai diturunkan dari indeks generate_series, tak
--     ada random(). Semua orang dapat data IDENTIK, jadi laporan bug bisa
--     direproduksi ("item 4210 salah hitung" berarti sama di semua laptop).
--   · IDEMPOTEN — aman dijalankan berulang (ON CONFLICT DO NOTHING).
--   · TERTANDAI JELAS — semua nama diawali "SINTETIS", semua id di ruang
--     900.000.000+. Tak mungkin tertukar dengan data nyata, bahkan di screenshot.
--
-- JANGAN dijalankan di prod. Tak ada gunanya di sana, dan namanya akan muncul
-- di menu seperti data betulan.
--
-- Pakai:
--   psql -d wrg_os_dev -f scripts/qa/seed-volume-sintetis.sql
--
-- Bersihkan semuanya (aman, hanya menyentuh ruang id sintetis):
--   psql -d wrg_os_dev -f scripts/qa/seed-volume-sintetis.sql --set=hapus=1
--   → atau manual: DELETE ... WHERE id >= 900000000  (urutan: item dulu, induk belakangan)

\set ON_ERROR_STOP on

-- ── 0. Pelanggan sintetis (500) ────────────────────────────────────────────
INSERT INTO accurate_customer (id, no, name, branch_id, last_synced_at)
SELECT 900000000 + i,
       'CUST-SIN-' || lpad(i::text, 4, '0'),
       'FASKES SINTETIS ' || lpad(i::text, 3, '0'),
       50 + (i % 12),
       now()
FROM generate_series(1, 500) i
ON CONFLICT (id) DO NOTHING;

-- ── 1. Item sintetis (6.000) ───────────────────────────────────────────────
-- unit_price & quantity diturunkan dari i supaya sebarannya lebar tapi tetap
-- sama di setiap mesin. Kategori & unit dirotasi agar filter/group-by teruji.
INSERT INTO accurate_item (id, no, name, category, unit_price, quantity, available, unit, last_synced_at)
SELECT 900000000 + i,
       'SIN.' || lpad(i::text, 5, '0'),
       'ITEM SINTETIS ' || lpad(i::text, 4, '0') || ' ' ||
         (ARRAY['REAGEN','ALAT','CONSUMABLE','CONTROL','KALIBRATOR'])[1 + (i % 5)],
       (ARRAY['IVD-REAGEN','IVD-ALAT','MEDICAL','CONSUMABLE'])[1 + (i % 4)],
       25000 + (i % 400) * 12500,                    -- Rp 25rb – 5,01jt
       (i * 7) % 900,                                 -- 0 – 899
       (i * 7) % 900,
       (ARRAY['PCS','BOX','PACK','UNIT','VIAL'])[1 + (i % 5)],
       now()
FROM generate_series(1, 6000) i
ON CONFLICT (id) DO NOTHING;

-- ── 2. Stok per gudang cabang ──────────────────────────────────────────────
-- INI yang membuat menu Stock Gudang & ED Watch bermakna. Di prod tabel ini
-- diisi importer CSV manual (tak ada cron), jadi di lingkungan uji ia HARUS
-- diisi sendiri — kalau tidak, menu-nya tampil cakupan 0% dan orang salah
-- menyimpulkan fiturnya rusak.
--
-- Sengaja TIDAK semua item punya stok di semua gudang: tiap item hadir di 1–4
-- gudang saja. Itu meniru kenyataan (barang tak merata) DAN membuat perbedaan
-- "belum diisi" vs "stok habis" ikut teruji — quantity 0 pun sengaja ada.
INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source, updated_at)
SELECT ai.id, w.kode,
       CASE WHEN (ai.id + length(w.kode)) % 11 = 0 THEN 0        -- ~9% stok habis
            ELSE ((ai.id * 3 + length(w.kode) * 17) % 250) END,
       'import',
       now() - ((ai.id % 30) || ' days')::interval
FROM accurate_item ai
CROSS JOIN warehouse w
WHERE ai.id >= 900000000
  AND w.jenis = 'cabang'
  AND (ai.id + length(w.kode)) % 4 = 0                            -- ~1 dari 4 pasangan
ON CONFLICT (item_id, warehouse_kode) DO NOTHING;

-- ── 2b. Batch + tanggal ED (untuk menu ED Watch) ───────────────────────────
-- Sama seperti item_stock_branch: di prod tabel ini diisi importer CSV manual,
-- jadi di lingkungan uji harus diisi sendiri atau ED Watch tampil kosong.
--
-- ed_date SENGAJA disebar melewati semua ambang alert (90/60/30 hari dan sudah
-- kedaluwarsa) supaya menu-nya benar-benar punya sesuatu untuk ditampilkan di
-- tiap tingkat. Tanpa sebaran ini, ED Watch teknis "jalan" tapi tak pernah
-- memperlihatkan perilaku yang justru jadi inti fiturnya.
--
-- alert_tier_terkirim dibiarkan NULL (CHECK hanya mengizinkan 90/60/30/0) —
-- artinya "belum pernah dialerti", keadaan awal yang benar.
INSERT INTO item_stock_batch (item_id, warehouse_kode, batch_no, ed_date, quantity, source, updated_at)
SELECT ai.id, w.kode,
       'BATCH-SIN-' || lpad(((ai.id % 97) + 1)::text, 3, '0'),
       (current_date + (CASE (ai.id + length(w.kode)) % 6
          WHEN 0 THEN -20    -- sudah kedaluwarsa
          WHEN 1 THEN  15    -- < 30 hari
          WHEN 2 THEN  45    -- < 60 hari
          WHEN 3 THEN  75    -- < 90 hari
          WHEN 4 THEN 200
          ELSE        400 END))::date,
       ((ai.id * 5) % 180) + 1,
       'import',
       now()
FROM accurate_item ai
CROSS JOIN warehouse w
WHERE ai.id >= 900000000
  AND w.jenis = 'cabang'
  AND (ai.id + length(w.kode)) % 19 = 0            -- ~1 dari 19 pasangan
ON CONFLICT (item_id, warehouse_kode, batch_no) DO NOTHING;

-- ── 3. Salesman sintetis, disambungkan ke AM bila memungkinkan ─────────────
-- Dibutuhkan Sales Performance & Sales Analytics (resolve salesman → AM).
--
-- JEBAKAN TIPE: accurate_salesman.master_user_id itu BIGINT, sementara
-- master_user.am_id itu TEXT. Di DB dev yang baru, am_id-nya 'demo1' / 'QA-AM-1'
-- — tak bisa di-cast ke bigint sama sekali. Jadi penautan hanya dilakukan untuk
-- am_id yang numerik; sisanya NULL, dan itu keadaan yang SAH: baris tanpa AM
-- diperlakukan sebagai VACANT oleh joinAmFromSalesman. Justru bagus — jalur
-- VACANT itu ikut teruji, bukan diakali.
INSERT INTO accurate_salesman (id, name, number, branch_id, suspended, master_user_id, last_synced_at)
SELECT 900000000 + i,
       'SALES SINTETIS ' || i,
       'SLS-SIN-' || lpad(i::text, 2, '0'),
       50 + (i % 12),
       false,
       (SELECT am_id::bigint FROM master_user
         WHERE am_id ~ '^[0-9]+$' ORDER BY am_id
         LIMIT 1 OFFSET ((i - 1) % GREATEST((SELECT count(*) FROM master_user WHERE am_id ~ '^[0-9]+$'), 1))),
       now()
FROM generate_series(1, 10) i
ON CONFLICT (id) DO NOTHING;

-- ── 4. Faktur sintetis (2.000, tersebar 12 bulan terakhir) ─────────────────
-- Angka dibuat KOHEREN supaya rekonsiliasi nyata teruji:
--   taxable_amount + tax_amount = total   ·   paid + outstanding = total
-- Ini penting: Sales Analytics memakai netto tanpa PPN, jadi kalau tax-nya
-- ngawur, angka menu-nya jadi mustahil dan orang mengira ada bug hitung.
INSERT INTO accurate_invoice (id, number, customer_id, branch_id, tanggal,
                              taxable_amount, tax_amount, total, paid, outstanding,
                              status, salesman_id, salesman_name, last_synced_at)
SELECT 900000000 + i,
       'INV-SIN-' || lpad(i::text, 5, '0'),
       900000000 + 1 + (i % 500),
       50 + (i % 12),
       (current_date - ((i * 5) % 365))::date,
       dpp, round(dpp * 0.11, 2), dpp + round(dpp * 0.11, 2),
       CASE WHEN i % 5 = 0 THEN 0                                  -- 20% belum bayar
            WHEN i % 5 = 1 THEN round((dpp + round(dpp*0.11,2)) * 0.5, 2)
            ELSE dpp + round(dpp * 0.11, 2) END,
       CASE WHEN i % 5 = 0 THEN dpp + round(dpp * 0.11, 2)
            WHEN i % 5 = 1 THEN round((dpp + round(dpp*0.11,2)) * 0.5, 2)
            ELSE 0 END,
       CASE WHEN i % 5 IN (0, 1) THEN 'UNPAID' ELSE 'PAID' END,
       900000000 + 1 + (i % 10),
       'SALES SINTETIS ' || (1 + (i % 10)),
       now()
FROM (SELECT i, (500000 + (i % 200) * 175000)::numeric AS dpp FROM generate_series(1, 2000) i) s
ON CONFLICT (id) DO NOTHING;

-- ── 5. Baris faktur (12.000 — 6 per faktur) ────────────────────────────────
INSERT INTO accurate_invoice_item (id, invoice_id, item_id, line_no, qty, unit,
                                   unit_price, discount_amount, total)
SELECT 900000000 + ((inv - 1) * 6 + ln),
       900000000 + inv,
       900000000 + 1 + ((inv * 6 + ln) % 6000),
       ln,
       1 + ((inv + ln) % 20),
       'PCS',
       hrg,
       0,
       hrg * (1 + ((inv + ln) % 20))
FROM generate_series(1, 2000) inv
CROSS JOIN generate_series(1, 6) ln
CROSS JOIN LATERAL (SELECT (25000 + ((inv * 6 + ln) % 400) * 12500)::numeric AS hrg) h
ON CONFLICT (id) DO NOTHING;

-- ── 6. Sales order (3.400) + barisnya ──────────────────────────────────────
INSERT INTO accurate_sales_order (id, number, trans_date, customer_name, status,
                                  total_amount, last_synced_at, items_synced_at)
SELECT 900000000 + i,
       'SO-SIN-' || lpad(i::text, 5, '0'),
       (current_date - ((i * 3) % 300))::date,
       'FASKES SINTETIS ' || lpad((1 + (i % 500))::text, 3, '0'),
       (ARRAY['OPEN','CLOSED','PARTIAL'])[1 + (i % 3)],
       (750000 + (i % 300) * 225000)::numeric,
       now(), now()
FROM generate_series(1, 3400) i
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_sales_order_item (order_id, line_no, item_no, item_name, qty, unit)
SELECT 900000000 + so, ln,
       'SIN.' || lpad((1 + ((so * 3 + ln) % 6000))::text, 5, '0'),
       'ITEM SINTETIS ' || lpad((1 + ((so * 3 + ln) % 6000))::text, 4, '0'),
       1 + ((so + ln) % 15), 'PCS'
FROM generate_series(1, 3400) so
CROSS JOIN generate_series(1, 3) ln
ON CONFLICT (order_id, line_no) DO NOTHING;

-- ── 7. Delivery order (3.300) + barisnya ───────────────────────────────────
INSERT INTO accurate_delivery_order (id, number, trans_date, customer_name, ship_to,
                                     status, last_synced_at, items_synced_at)
SELECT 900000000 + i,
       'SJ-SIN-' || lpad(i::text, 5, '0'),
       (current_date - ((i * 3) % 300))::date,
       'FASKES SINTETIS ' || lpad((1 + (i % 500))::text, 3, '0'),
       'Alamat Sintetis No. ' || i,
       (ARRAY['DELIVERED','IN_TRANSIT','PENDING'])[1 + (i % 3)],
       now(), now()
FROM generate_series(1, 3300) i
ON CONFLICT (id) DO NOTHING;

INSERT INTO accurate_delivery_order_item (delivery_id, line_no, item_no, item_name, qty, unit)
SELECT 900000000 + dl, ln,
       'SIN.' || lpad((1 + ((dl * 3 + ln) % 6000))::text, 5, '0'),
       'ITEM SINTETIS ' || lpad((1 + ((dl * 3 + ln) % 6000))::text, 4, '0'),
       1 + ((dl + ln) % 15), 'PCS'
FROM generate_series(1, 3300) dl
CROSS JOIN generate_series(1, 3) ln
ON CONFLICT (delivery_id, line_no) DO NOTHING;

-- ── 8. Price book sintetis (500 SKU) ───────────────────────────────────────
-- Melengkapi 3 SKU QA di seed-hashtag-fixtures.sql supaya #PRICING dan menu
-- Price Book punya isi. row_no 800001+ menghindari bentrok UNIQUE(periode,row_no)
-- dengan fixture QA (900001+) maupun impor nyata.
-- diskon_maks dirotasi 0 / 5 / 10 / 15 / 20% agar gerbang plafon diskon teruji.
INSERT INTO product_pricelist
  (periode, row_no, kode, lini, brand, nama, varian, kemasan,
   price_list, diskon_maks, harga_nett, nett_ppn)
SELECT 'H2-2026', 800000 + i,
       'SIN-PL-' || lpad(i::text, 4, '0'),
       (ARRAY['IVD','Medical'])[1 + (i % 2)],
       'BRAND SINTETIS ' || (1 + (i % 8)),
       'PRODUK SINTETIS ' || lpad(i::text, 3, '0'),
       CASE WHEN i % 3 = 0 THEN 'Varian ' || (1 + (i % 4)) ELSE NULL END,
       (ARRAY['Box','Pack','Unit'])[1 + (i % 3)],
       pl, dm, round(pl * (1 - dm), 2), round(pl * (1 - dm) * 1.11, 2)
FROM (SELECT i,
             (100000 + (i % 250) * 40000)::numeric AS pl,
             ((i % 5) * 0.05)::numeric            AS dm
      FROM generate_series(1, 500) i) s
ON CONFLICT (periode, row_no) DO NOTHING;

-- ── ringkasan ──────────────────────────────────────────────────────────────
SELECT 'accurate_item'          AS tabel, count(*) AS baris_sintetis FROM accurate_item          WHERE id >= 900000000
UNION ALL SELECT 'accurate_customer',        count(*) FROM accurate_customer        WHERE id >= 900000000
UNION ALL SELECT 'accurate_invoice',         count(*) FROM accurate_invoice         WHERE id >= 900000000
UNION ALL SELECT 'accurate_invoice_item',    count(*) FROM accurate_invoice_item    WHERE id >= 900000000
UNION ALL SELECT 'accurate_sales_order',     count(*) FROM accurate_sales_order     WHERE id >= 900000000
UNION ALL SELECT 'accurate_delivery_order',  count(*) FROM accurate_delivery_order  WHERE id >= 900000000
UNION ALL SELECT 'item_stock_branch',        count(*) FROM item_stock_branch        WHERE item_id >= 900000000
UNION ALL SELECT 'item_stock_batch',          count(*) FROM item_stock_batch          WHERE item_id >= 900000000
UNION ALL SELECT 'product_pricelist (SIN)',  count(*) FROM product_pricelist        WHERE row_no >= 800000 AND row_no < 900000
ORDER BY 1;
