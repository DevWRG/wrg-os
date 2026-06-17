-- Mirror sales-order Accurate (recent) untuk menu Orders. Volume besar (11rb+),
-- jadi cuma sync terbaru (sort transDate desc, beberapa halaman).
CREATE TABLE IF NOT EXISTS accurate_sales_order (
  id             bigint PRIMARY KEY,
  number         text,
  trans_date     date,
  customer_name  text,
  status         text,
  total_amount   numeric(18,2),
  raw            jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accurate_so_date_idx ON accurate_sales_order (trans_date DESC);
