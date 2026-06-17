-- Mirror vendor/supplier dari Accurate (vendor/list.do) — buat menu Suppliers.
CREATE TABLE IF NOT EXISTS accurate_vendor (
  id             bigint PRIMARY KEY,
  name           text,
  branch_name    text,
  raw            jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
