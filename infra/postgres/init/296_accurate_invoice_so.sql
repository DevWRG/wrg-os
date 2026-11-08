-- 296_accurate_invoice_so.sql — DOC: tautan OTOMATIS faktur ↔ Sales Order dari Accurate.
--
-- MASALAH. Doc Tracker (258) hanya mengenal faktur lewat tautan manual (doc_tracker_faktur), padahal
-- ±92% faktur Accurate membawa rujukannya sendiri: accurate_invoice.raw->'detailItem'[*].salesOrderId.
-- Tanpa tautan itu hampir semua SO tak pernah sampai Billed/Paid.
--
-- KENAPA TABEL, BUKAN BACA `raw` SAAT QUERY. `raw` faktur besar dan tersimpan di TOAST; menyaring/
-- menggabung lewat raw->'detailItem' di kueri daftar = detoast setiap baris (jebakan performa prod
-- yang sudah terukur, lihat 186 & #1417). Di sini pasangan (invoice_id, so_id) diturunkan SEKALI saat
-- baris ditulis (trigger), sehingga kueri daftar cukup indeks so_id.
--
-- SINKRON. accurateSync.ts menulis faktur lewat INSERT ... ON CONFLICT DO UPDATE SET raw = ... →
-- trigger AFTER INSERT/UPDATE OF raw menghapus lalu mengisi ulang tautan faktur itu (salesOrderId
-- unik, numerik, bukan nol). raw NULL / detailItem bukan array → tautan faktur dihapus saja.
-- WHERE sengaja tanpa ::bigint: urutan evaluasi AND tak dijamin, cast teks non-angka = galat.
-- Faktur yang dihapus dari cermin (faktur hilang) ikut membuang tautannya (AFTER DELETE).
-- Tanpa FK ke accurate_sales_order: mirror SO hanya ±500 terbaru, faktur boleh merujuk SO lama.
-- Additive & idempoten; transaksi diatur runner.

CREATE TABLE IF NOT EXISTS accurate_invoice_so (
  invoice_id bigint NOT NULL,
  so_id      bigint NOT NULL,
  PRIMARY KEY (invoice_id, so_id)
);
CREATE INDEX IF NOT EXISTS accurate_invoice_so_so_idx ON accurate_invoice_so (so_id);

CREATE OR REPLACE FUNCTION accurate_invoice_so_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM accurate_invoice_so WHERE invoice_id = OLD.id;
    RETURN OLD;
  END IF;
  DELETE FROM accurate_invoice_so WHERE invoice_id = NEW.id;
  IF NEW.raw IS NOT NULL AND jsonb_typeof(NEW.raw->'detailItem') = 'array' THEN
    INSERT INTO accurate_invoice_so (invoice_id, so_id)
    SELECT DISTINCT NEW.id, (e->>'salesOrderId')::bigint
    FROM jsonb_array_elements(NEW.raw->'detailItem') e
    WHERE jsonb_typeof(e) = 'object' AND e->>'salesOrderId' ~ '^[0-9]{1,18}$' AND e->>'salesOrderId' !~ '^0+$'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS accurate_invoice_so_trg ON accurate_invoice;
CREATE TRIGGER accurate_invoice_so_trg
  AFTER INSERT OR UPDATE OF raw OR DELETE ON accurate_invoice
  FOR EACH ROW EXECUTE FUNCTION accurate_invoice_so_sync();

-- Isi awal dari faktur yang sudah ada (sekali baca raw; selanjutnya trigger).
INSERT INTO accurate_invoice_so (invoice_id, so_id)
SELECT DISTINCT ai.id, (e->>'salesOrderId')::bigint
FROM accurate_invoice ai
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(ai.raw->'detailItem') = 'array' THEN ai.raw->'detailItem' ELSE '[]'::jsonb END) e
WHERE jsonb_typeof(e) = 'object' AND e->>'salesOrderId' ~ '^[0-9]{1,18}$' AND e->>'salesOrderId' !~ '^0+$'
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    -- INSERT/DELETE: trigger berjalan sebagai peran penulis faktur (sinkron Accurate).
    GRANT SELECT, INSERT, DELETE ON accurate_invoice_so TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON accurate_invoice_so TO wrg_readonly;
  END IF;
END $$;
