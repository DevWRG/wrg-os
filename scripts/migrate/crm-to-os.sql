-- ════════════════════════════════════════════════════════════════════════
-- Migrasi data legacy → wrg-os   (wrg_crm_prod → wrg_os_dev)
-- ════════════════════════════════════════════════════════════════════════
-- Sifat   : ADDITIVE / non-destruktif. Tidak pernah DELETE/TRUNCATE.
--           - tabel id sejajar (bigint)  → UPSERT by id
--           - tabel uuid / re-seed        → INSERT-MISSING by natural key
-- Kunci    : os.am_id = prod.user_id::text  (id-space identik, wrg-os di-port dari prod ini)
-- Skema    : wrg-os dirancang ulang → pemetaan kolom eksplisit (bukan dump/restore).
-- Aman ulang: idempotent — boleh dijalankan berkali-kali (mis. saat cutover untuk
--           menarik delta terbaru dari prod).
--
-- Jalankan : psql "$DATABASE_URL" -f scripts/migrate/crm-to-os.sql
--   (DATABASE_URL = koneksi wrg_os_dev; user harus superuser utk session_replication_role + FDW)
--
-- Catatan  : Membaca prod via postgres_fdw (schema prod_fdw). Koneksi FDW di bawah
--           spesifik mesin (localhost / wrg_crm_prod / role 'development'). Sesuaikan
--           bila host/role berbeda.
-- ════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── 0. Setup postgres_fdw → wrg_crm_prod (idempotent) ───────────────────
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
DROP SERVER IF EXISTS prod_srv CASCADE;
CREATE SERVER prod_srv FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'localhost', dbname 'wrg_crm_prod', port '5432');
CREATE USER MAPPING FOR CURRENT_USER SERVER prod_srv OPTIONS (user 'development');
CREATE SCHEMA IF NOT EXISTS prod_fdw;
IMPORT FOREIGN SCHEMA public LIMIT TO (
  master_user, activity_log, sales_plan, sales_todo, competitor_intel,
  accurate_branch, accurate_customer, accurate_invoice, accurate_invoice_item,
  accurate_item, accurate_salesman, master_holiday, master_territory,
  am_reminder, user_leave, sales_target_area, sales_target_branch
) FROM SERVER prod_srv INTO prod_fdw;

BEGIN;
SET session_replication_role = replica;  -- bypass FK/trigger saat bulk-load

-- ── 1. MASTER / REFERENCE ───────────────────────────────────────────────
INSERT INTO public.master_user (am_id, aktif, area, cabang, created_at, nama, panggilan, posisi, role, wa_number, wajib_plan_report)
SELECT id::text, aktif, area, cabang, created_at, nama, panggilan, posisi, role, wa_number, wajib_plan_report
FROM prod_fdw.master_user
ON CONFLICT (am_id) DO UPDATE SET aktif=EXCLUDED.aktif, area=EXCLUDED.area, cabang=EXCLUDED.cabang,
  nama=EXCLUDED.nama, panggilan=EXCLUDED.panggilan, posisi=EXCLUDED.posisi, role=EXCLUDED.role,
  wa_number=EXCLUDED.wa_number, wajib_plan_report=EXCLUDED.wajib_plan_report;

INSERT INTO public.sales_target_area (area, daily, monthly, weekly, yearly, updated_at)
SELECT area, daily, monthly, weekly, yearly, updated_at FROM prod_fdw.sales_target_area
ON CONFLICT (area) DO UPDATE SET daily=EXCLUDED.daily, monthly=EXCLUDED.monthly,
  weekly=EXCLUDED.weekly, yearly=EXCLUDED.yearly, updated_at=EXCLUDED.updated_at;

INSERT INTO public.sales_target_branch (area, cabang, monthly, notes, total_yearly, updated_at)
SELECT area, cabang, monthly, notes, total_yearly, updated_at FROM prod_fdw.sales_target_branch
ON CONFLICT (cabang) DO UPDATE SET area=EXCLUDED.area, monthly=EXCLUDED.monthly,
  notes=EXCLUDED.notes, total_yearly=EXCLUDED.total_yearly, updated_at=EXCLUDED.updated_at;

-- master_holiday: os.id uuid → insert-missing by tanggal
INSERT INTO public.master_holiday (keterangan, tanggal)
SELECT p.keterangan, p.tanggal FROM prod_fdw.master_holiday p
WHERE NOT EXISTS (SELECT 1 FROM public.master_holiday o WHERE o.tanggal = p.tanggal);
-- master_territory: identik (skip)

-- ── 2. ACCURATE (id bigint sejajar → upsert by id) ──────────────────────
INSERT INTO public.accurate_branch (id, name, raw, suspended, last_synced_at)
SELECT id, name, raw, suspended, now() FROM prod_fdw.accurate_branch
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, raw=EXCLUDED.raw, suspended=EXCLUDED.suspended, last_synced_at=now();

INSERT INTO public.accurate_customer (branch_id, id, last_synced_at, name, no, raw)
SELECT branch_id, id, last_synced_at, name, no, raw FROM prod_fdw.accurate_customer
ON CONFLICT (id) DO UPDATE SET branch_id=EXCLUDED.branch_id, last_synced_at=EXCLUDED.last_synced_at,
  name=EXCLUDED.name, no=EXCLUDED.no, raw=EXCLUDED.raw;

INSERT INTO public.accurate_salesman (branch_id, cabang_override, employee_work_status, id, last_synced_at, master_user_id, name, number, raw, suspended)
SELECT branch_id, cabang_override, employee_work_status, id, last_synced_at, master_user_id, name, number, raw, suspended FROM prod_fdw.accurate_salesman
ON CONFLICT (id) DO UPDATE SET branch_id=EXCLUDED.branch_id, cabang_override=EXCLUDED.cabang_override,
  employee_work_status=EXCLUDED.employee_work_status, last_synced_at=EXCLUDED.last_synced_at,
  master_user_id=EXCLUDED.master_user_id, name=EXCLUDED.name, number=EXCLUDED.number, raw=EXCLUDED.raw, suspended=EXCLUDED.suspended;

INSERT INTO public.accurate_item (id, category, name, no, raw, unit_price, last_synced_at)
SELECT id, category, name, no, raw, unit_price, now() FROM prod_fdw.accurate_item
ON CONFLICT (id) DO UPDATE SET category=EXCLUDED.category, name=EXCLUDED.name, no=EXCLUDED.no,
  raw=EXCLUDED.raw, unit_price=EXCLUDED.unit_price, last_synced_at=now();

INSERT INTO public.accurate_invoice (branch_id, customer_id, id, last_synced_at, number, outstanding, paid, raw, salesman_id, salesman_name, status, tanggal, tax_amount, taxable_amount, total)
SELECT branch_id, customer_id, id, last_synced_at, number, outstanding, paid, raw, salesman_id, salesman_name, status, tanggal, tax_amount, taxable_amount, total FROM prod_fdw.accurate_invoice
ON CONFLICT (id) DO UPDATE SET branch_id=EXCLUDED.branch_id, customer_id=EXCLUDED.customer_id,
  last_synced_at=EXCLUDED.last_synced_at, number=EXCLUDED.number, outstanding=EXCLUDED.outstanding,
  paid=EXCLUDED.paid, raw=EXCLUDED.raw, salesman_id=EXCLUDED.salesman_id, salesman_name=EXCLUDED.salesman_name,
  status=EXCLUDED.status, tanggal=EXCLUDED.tanggal, tax_amount=EXCLUDED.tax_amount,
  taxable_amount=EXCLUDED.taxable_amount, total=EXCLUDED.total;

INSERT INTO public.accurate_invoice_item (discount_amount, id, invoice_id, item_id, line_no, qty, raw, total, unit, unit_price)
SELECT discount_amount, id, invoice_id, item_id, line_no, qty, raw, total, unit, unit_price FROM prod_fdw.accurate_invoice_item
ON CONFLICT (id) DO UPDATE SET discount_amount=EXCLUDED.discount_amount, invoice_id=EXCLUDED.invoice_id,
  item_id=EXCLUDED.item_id, line_no=EXCLUDED.line_no, qty=EXCLUDED.qty, raw=EXCLUDED.raw,
  total=EXCLUDED.total, unit=EXCLUDED.unit, unit_price=EXCLUDED.unit_price;

-- ── 3. CRM TRANSAKSIONAL ────────────────────────────────────────────────
-- sales_plan: id bigint sejajar → upsert by id (am_id = user_id::text)
INSERT INTO public.sales_plan (am_id, activity_id, created_at, customer_name, goal, id, is_late_plan, reported, reported_at, seq, submitted_at, tanggal, tujuan, visit_date_mismatch, visit_lat, visit_lon, visit_timestamp)
SELECT user_id::text, activity_id, created_at, customer_name, goal, id, is_late_plan, reported, reported_at, seq, submitted_at, tanggal, tujuan, visit_date_mismatch, visit_lat, visit_lon, visit_timestamp FROM prod_fdw.sales_plan
ON CONFLICT (id) DO UPDATE SET am_id=EXCLUDED.am_id, activity_id=EXCLUDED.activity_id,
  customer_name=EXCLUDED.customer_name, goal=EXCLUDED.goal, is_late_plan=EXCLUDED.is_late_plan,
  reported=EXCLUDED.reported, reported_at=EXCLUDED.reported_at, seq=EXCLUDED.seq,
  submitted_at=EXCLUDED.submitted_at, tanggal=EXCLUDED.tanggal, tujuan=EXCLUDED.tujuan,
  visit_date_mismatch=EXCLUDED.visit_date_mismatch, visit_lat=EXCLUDED.visit_lat,
  visit_lon=EXCLUDED.visit_lon, visit_timestamp=EXCLUDED.visit_timestamp;

-- activity_log: id bigint sejajar → upsert by id
INSERT INTO public.activity_log (am_id, created_at, customer_name, hasil, id, is_unmatched, match_score, message_id, next_action, plan_id, source, tanggal, todo_id, todo_item_idx, tujuan)
SELECT user_id::text, created_at, customer_name, hasil, id, is_unmatched, match_score, message_id, next_action, plan_id, source, tanggal, todo_id, todo_item_idx, tujuan FROM prod_fdw.activity_log
ON CONFLICT (id) DO UPDATE SET am_id=EXCLUDED.am_id, customer_name=EXCLUDED.customer_name,
  hasil=EXCLUDED.hasil, is_unmatched=EXCLUDED.is_unmatched, match_score=EXCLUDED.match_score,
  message_id=EXCLUDED.message_id, next_action=EXCLUDED.next_action, plan_id=EXCLUDED.plan_id,
  source=EXCLUDED.source, tanggal=EXCLUDED.tanggal, todo_id=EXCLUDED.todo_id,
  todo_item_idx=EXCLUDED.todo_item_idx, tujuan=EXCLUDED.tujuan;

-- sales_todo: os.id uuid → insert-missing by (am_id, tanggal) [unik di kedua sisi]
INSERT INTO public.sales_todo (am_id, am_name, created_at, is_late_plan, items, raw_body, report_data, reported, reported_at, tanggal)
SELECT t.user_id::text, mu.nama, t.created_at, t.is_late_plan, t.items, t.raw_body, t.report_data, t.reported, t.reported_at, t.tanggal
FROM prod_fdw.sales_todo t LEFT JOIN prod_fdw.master_user mu ON mu.id = t.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.sales_todo o WHERE o.am_id = t.user_id::text AND o.tanggal = t.tanggal);

-- competitor_intel: os.id uuid → insert-missing by (vendor,tanggal,customer_name,produk)
INSERT INTO public.competitor_intel (am_id, created_at, source, customer_name, harga_numeric, harga_text, konteks, produk, produk_kategori, tanggal, vendor)
SELECT p.user_id::text, p.extracted_at, 'crm', p.customer_name, p.harga_numeric, p.harga_text, p.konteks, p.produk, p.produk_kategori, p.tanggal, p.vendor
FROM prod_fdw.competitor_intel p
WHERE NOT EXISTS (SELECT 1 FROM public.competitor_intel o
  WHERE o.vendor = p.vendor AND o.tanggal = p.tanggal
    AND COALESCE(o.customer_name,'') = COALESCE(p.customer_name,'')
    AND COALESCE(o.produk,'') = COALESCE(p.produk,''));

-- user_leave: os.id uuid → insert-missing by (am_id,start_date,jenis)
INSERT INTO public.user_leave (am_id, source, created_at, end_date, jenis, keterangan, start_date)
SELECT p.user_id::text, 'crm', p.created_at, p.end_date, p.jenis, p.keterangan, p.start_date
FROM prod_fdw.user_leave p
WHERE NOT EXISTS (SELECT 1 FROM public.user_leave o
  WHERE o.am_id = p.user_id::text AND o.start_date = p.start_date AND o.jenis = p.jenis);

SET session_replication_role = default;

-- ── 4. Reset sequence (hanya tabel ber-serial id; guard null utk uuid/external) ──
DO $$
DECLARE t text; seq text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_plan','activity_log','accurate_branch','accurate_customer','accurate_salesman','accurate_item','accurate_invoice','accurate_invoice_item'] LOOP
    seq := pg_get_serial_sequence('public.'||t, 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(max(id),1) FROM public.%I), 1))', seq, t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verifikasi cepat (opsional):
--   SELECT 'sales_plan', count(*) FROM sales_plan UNION ALL SELECT 'accurate_invoice', count(*) FROM accurate_invoice;
