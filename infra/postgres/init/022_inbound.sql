-- 022_inbound.sql — dukungan pemrosesan inbound WA (#PLAN/#REPORT) di wrg-os.
-- Pengganti legacy wrg-inbound.sh: parse pesan masuk → sales_plan/sales_todo/
-- activity_log + balas grup. Default GATED (WA_INBOUND_PROCESS) — migrasi ini
-- hanya menyiapkan skema, tidak mengubah perilaku.

-- 1. Sequence untuk id baris baru (sales_plan/activity_log id = BIGINT non-serial,
--    data migrasi pakai id eksplisit dari prod). Sequence di-set di atas max saat
--    cutover via ETL final; insert inbound pakai nextval.
CREATE SEQUENCE IF NOT EXISTS sales_plan_id_seq;
SELECT setval('sales_plan_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM sales_plan), 1));
ALTER TABLE sales_plan ALTER COLUMN id SET DEFAULT nextval('sales_plan_id_seq');
ALTER SEQUENCE sales_plan_id_seq OWNED BY sales_plan.id;

CREATE SEQUENCE IF NOT EXISTS activity_log_id_seq;
SELECT setval('activity_log_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM activity_log), 1));
ALTER TABLE activity_log ALTER COLUMN id SET DEFAULT nextval('activity_log_id_seq');
ALTER SEQUENCE activity_log_id_seq OWNED BY activity_log.id;

-- 2. Idempotensi & jejak pemrosesan di wa_message.
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS message_id       TEXT;
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS processed_at     TIMESTAMPTZ;
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS processed_kind   TEXT;
ALTER TABLE wa_message ADD COLUMN IF NOT EXISTS processed_result JSONB;
CREATE INDEX IF NOT EXISTS wa_message_unprocessed_idx
  ON wa_message (received_at) WHERE processed_at IS NULL;

-- 3. Backfill: tandai pesan historis (sebelum fitur ini) sebagai sudah-diproses,
--    supaya saat WA_INBOUND_PROCESS diaktifkan TIDAK memproses ulang arsip lama.
UPDATE wa_message SET processed_at = now(), processed_kind = 'backfill-skip'
WHERE processed_at IS NULL;
