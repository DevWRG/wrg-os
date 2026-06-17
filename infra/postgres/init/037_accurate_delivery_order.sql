-- Mirror delivery-order Accurate (recent) untuk menu Shipments. Volume besar (11rb+),
-- jadi cuma sync terbaru (sort transDate desc, beberapa halaman). Pola sama spt 036.
CREATE TABLE IF NOT EXISTS accurate_delivery_order (
  id             bigint PRIMARY KEY,
  number         text,
  trans_date     date,
  customer_name  text,
  ship_to        text,
  status         text,
  raw            jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accurate_do_date_idx ON accurate_delivery_order (trans_date DESC);
