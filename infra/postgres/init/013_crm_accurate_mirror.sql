-- Mirror master Accurate (port legacy accurate_customer/item/branch). Invoice
-- AR sudah ditangani 004 + /webhooks/accurate; ini melengkapi master data.
CREATE TABLE IF NOT EXISTS accurate_customer (
  id             BIGINT PRIMARY KEY,
  no             TEXT,
  name           TEXT,
  branch_id      BIGINT,
  raw            JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS accurate_branch (
  id             BIGINT PRIMARY KEY,
  name           TEXT,
  suspended      BOOLEAN NOT NULL DEFAULT FALSE,
  raw            JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS accurate_item (
  id             BIGINT PRIMARY KEY,
  no             TEXT,
  name           TEXT,
  category       TEXT,
  unit_price     NUMERIC(16,2),
  raw            JSONB,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
