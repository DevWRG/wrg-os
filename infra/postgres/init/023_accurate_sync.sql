-- 023_accurate_sync.sql — dukungan puller Accurate Online (pengganti sync_accurate.sh).
-- Menyiapkan state sync + sequence id untuk baris invoice-item baru.

-- State terakhir sync (per entity), untuk monitoring & incremental.
CREATE TABLE IF NOT EXISTS accurate_sync_state (
  entity           TEXT PRIMARY KEY,
  last_synced_at   TIMESTAMPTZ,
  last_run_ok      BOOLEAN,
  last_run_summary JSONB
);

-- accurate_invoice_item.id = BIGINT non-serial (data migrasi pakai id eksplisit
-- prod). Baris baru dari puller butuh id generated → sequence.
CREATE SEQUENCE IF NOT EXISTS accurate_invoice_item_id_seq;
SELECT setval('accurate_invoice_item_id_seq',
  GREATEST((SELECT COALESCE(max(id), 0) FROM accurate_invoice_item), 1));
ALTER TABLE accurate_invoice_item ALTER COLUMN id SET DEFAULT nextval('accurate_invoice_item_id_seq');
ALTER SEQUENCE accurate_invoice_item_id_seq OWNED BY accurate_invoice_item.id;
