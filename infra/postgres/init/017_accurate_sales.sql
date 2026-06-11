-- Accurate sales subsystem (port wrg-crm): invoice + item + salesman + target.
-- Sumber Revenue (Sales Performance) & AR (outstanding) di dashboard. id legacy
-- (integer) dipertahankan sbg BIGINT untuk relasi item.invoice_id→invoice.id,
-- invoice.customer_id→accurate_customer.id, invoice.item→accurate_item.id.

CREATE TABLE IF NOT EXISTS accurate_invoice (
  id              BIGINT PRIMARY KEY,
  number          TEXT,
  customer_id     BIGINT,
  branch_id       BIGINT,
  tanggal         DATE,
  taxable_amount  NUMERIC,
  tax_amount      NUMERIC,
  total           NUMERIC,
  paid            NUMERIC,
  outstanding     NUMERIC,
  status          TEXT,
  salesman_id     BIGINT,
  salesman_name   TEXT,
  raw             JSONB,
  last_synced_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS accurate_invoice_tanggal_idx ON accurate_invoice (tanggal);
CREATE INDEX IF NOT EXISTS accurate_invoice_customer_idx ON accurate_invoice (customer_id);
CREATE INDEX IF NOT EXISTS accurate_invoice_branch_idx ON accurate_invoice (branch_id);

CREATE TABLE IF NOT EXISTS accurate_invoice_item (
  id              BIGINT PRIMARY KEY,
  invoice_id      BIGINT,
  item_id         BIGINT,
  line_no         INTEGER,
  qty             NUMERIC,
  unit            TEXT,
  unit_price      NUMERIC,
  discount_amount NUMERIC,
  total           NUMERIC,
  raw             JSONB
);
CREATE INDEX IF NOT EXISTS accurate_invoice_item_invoice_idx ON accurate_invoice_item (invoice_id);
CREATE INDEX IF NOT EXISTS accurate_invoice_item_item_idx ON accurate_invoice_item (item_id);

CREATE TABLE IF NOT EXISTS accurate_salesman (
  id                   BIGINT PRIMARY KEY,
  name                 TEXT,
  number               TEXT,
  branch_id            BIGINT,
  suspended            BOOLEAN,
  employee_work_status TEXT,
  master_user_id       BIGINT,
  cabang_override      TEXT,
  raw                  JSONB,
  last_synced_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sales_target_branch (
  cabang       TEXT PRIMARY KEY,
  area         TEXT,
  total_yearly NUMERIC,
  monthly      NUMERIC,
  notes        TEXT,
  updated_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sales_target_area (
  area       TEXT PRIMARY KEY,
  yearly     NUMERIC,
  monthly    NUMERIC,
  weekly     NUMERIC,
  daily      NUMERIC,
  updated_at TIMESTAMPTZ
);
