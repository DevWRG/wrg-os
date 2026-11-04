-- 274 — Multi-Opsi Pipeline (#1964, Master PRD v2 §6.4 FR-EXT-MO).
--
-- Satu kebutuhan faskes bisa ditawari sampai TIGA alternatif (Opsi 1/2/3 — sengaja bukan
-- A/B/C: huruf itu sudah dipakai kategori forecast A-Commit/B-Best/C-Pipeline). Tiap opsi
-- tetap satu baris `deal` biasa; yang baru hanya penanda grupnya.
--
-- Keputusan pemilik (3–4 Nov 2026):
--   • Nilai pipeline grup = OPSI UTAMA yang dipilih AM, bukan jumlah semua opsi.
--   • Satu opsi Won → opsi lain yang masih jalan otomatis DI-DROP: bukan Lost, tanpa
--     approval HoD, tak masuk win-rate / alasan kalah.
--
-- ATURAN HITUNG (satu kolom, dipakai semua agregat): `opsi_utama`.
--   deal tanpa grup        → opsi_utama = true (default) → dihitung seperti biasa
--   opsi utama grup         → true                         → dihitung
--   opsi lain / di-drop     → false                        → tidak dihitung
-- Jadi setiap SUM/COUNT nilai pipeline cukup menambah `AND opsi_utama`.
--
-- DI-DROP disimpan sebagai stage 'Closing-Lost' + loss_status 'dropped' (loss_reason NULL).
-- Dengan stage tertutup, semua jalur yang hanya mengurus deal terbuka (job Dormant, #PLAN,
-- #REPORT, Demo & Trial, antrean approval Lost yang menyaring 'pending') otomatis
-- melewatinya tanpa diubah. Tahap sebelum di-drop disimpan supaya bisa dihidupkan lagi.
--
-- Aturan grup ditegakkan TRIGGER, bukan di kode, karena deal berpindah tahap lewat banyak
-- jalur (drag board, #REPORT recordReportTouch, approval Lost, job Dormant, importer):
--   1. Opsi masuk Closing-Won  → ia jadi utama; opsi lain yang masih jalan di-drop.
--   2. Won dibatalkan (keluar dari Closing-Won) → opsi yang di-drop OLEH-nya dihidupkan
--      lagi ke tahap semula.
--   3. Setelah perubahan tahap apa pun: kalau utama sudah tertutup (Lost) sementara opsi
--      lain masih jalan, utama pindah ke opsi terbuka bernomor terkecil. Kalau semua
--      tertutup, utama tetap di tempatnya → grup dihitung sekali (satu kebutuhan).
--
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi). Idempoten.

ALTER TABLE deal
  ADD COLUMN IF NOT EXISTS opsi_grup      uuid,
  ADD COLUMN IF NOT EXISTS opsi_no        smallint,
  ADD COLUMN IF NOT EXISTS opsi_utama     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS opsi_drop_oleh uuid,
  ADD COLUMN IF NOT EXISTS opsi_drop_dari text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_opsi_no_chk') THEN
    ALTER TABLE deal ADD CONSTRAINT deal_opsi_no_chk CHECK (opsi_no IS NULL OR opsi_no BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_opsi_pasangan_chk') THEN
    ALTER TABLE deal ADD CONSTRAINT deal_opsi_pasangan_chk CHECK ((opsi_grup IS NULL) = (opsi_no IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS deal_opsi_no_uq ON deal (opsi_grup, opsi_no) WHERE opsi_grup IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deal_opsi_utama_uq ON deal (opsi_grup) WHERE opsi_grup IS NOT NULL AND opsi_utama;

COMMENT ON COLUMN deal.opsi_grup IS 'Multi-Opsi (274): id grup = deal_id opsi pertama. NULL = deal tunggal.';
COMMENT ON COLUMN deal.opsi_no IS 'Multi-Opsi (274): Opsi 1/2/3 di dalam grup.';
COMMENT ON COLUMN deal.opsi_utama IS 'Multi-Opsi (274): baris DIHITUNG di nilai pipeline. true utk deal tunggal & opsi utama; false utk opsi lain/di-drop. Semua agregat: AND opsi_utama.';
COMMENT ON COLUMN deal.opsi_drop_oleh IS 'Multi-Opsi (274): deal_id opsi yang Won dan menyebabkan opsi ini di-drop.';
COMMENT ON COLUMN deal.opsi_drop_dari IS 'Multi-Opsi (274): tahap sebelum di-drop — tujuan bila Won dibatalkan.';

-- Turunan tahap → kategori/probabilitas/forecast. SAMA dengan STAGE_META di
-- apps/api/src/repo/deal.ts — jaga sinkron (dipakai saat opsi dihidupkan lagi).
CREATE OR REPLACE FUNCTION deal_opsi_meta(p_stage text, OUT prospect text, OUT prob numeric, OUT forecast text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage WHEN 'Negotiation' THEN 'Warm' WHEN 'Closing' THEN 'Hot' WHEN 'Closing-Won' THEN 'Hot'
                      WHEN 'Closing-Lost' THEN NULL ELSE 'Cold' END,
         CASE p_stage WHEN 'Prospecting' THEN 0.1 WHEN 'Presentation' THEN 0.3 WHEN 'Quotation' THEN 0.5
                      WHEN 'Negotiation' THEN 0.7 WHEN 'Closing' THEN 0.9 WHEN 'Closing-Won' THEN 1.0 ELSE 0.0 END,
         CASE p_stage WHEN 'Prospecting' THEN 'D - Omit' WHEN 'Presentation' THEN 'C - Pipeline'
                      WHEN 'Quotation' THEN 'C - Pipeline' WHEN 'Negotiation' THEN 'B - Best Case'
                      WHEN 'Closing' THEN 'A - Commit' WHEN 'Closing-Won' THEN 'Won' ELSE 'Lost' END
$$;

CREATE OR REPLACE FUNCTION deal_opsi_atur() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s       record;
  m       record;
  v_won   uuid;
  v_utama uuid;
  v_buka  uuid;
BEGIN
  -- 1. Opsi ini Won → jadi utama, opsi lain yang masih jalan di-drop.
  IF NEW.stage::text = 'Closing-Won' AND OLD.stage::text IS DISTINCT FROM 'Closing-Won' THEN
    FOR s IN
      SELECT deal_id, stage::text AS stage FROM deal
      WHERE opsi_grup = NEW.opsi_grup AND deal_id <> NEW.deal_id
        AND stage::text NOT IN ('Closing-Won', 'Closing-Lost')
      FOR UPDATE
    LOOP
      UPDATE deal SET
        opsi_drop_dari = s.stage, opsi_drop_oleh = NEW.deal_id, opsi_utama = false,
        stage = 'Closing-Lost', loss_status = 'dropped', loss_reason = NULL,
        prospect_category = NULL, probability = 0, forecast_category = 'Di-drop',
        dormant_at = NULL, stage_entered_at = now(), updated_at = now()
      WHERE deal_id = s.deal_id;
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      VALUES (s.deal_id, s.stage, 'Closing-Lost', 'system:opsi', 'di-drop: Opsi ' || NEW.opsi_no || ' Won');
    END LOOP;
  END IF;

  -- 2. Won dibatalkan → hidupkan lagi opsi yang di-drop olehnya.
  IF OLD.stage::text = 'Closing-Won' AND NEW.stage::text IS DISTINCT FROM 'Closing-Won' THEN
    FOR s IN
      SELECT deal_id, opsi_drop_dari FROM deal
      WHERE opsi_drop_oleh = NEW.deal_id AND loss_status = 'dropped'
      FOR UPDATE
    LOOP
      SELECT * INTO m FROM deal_opsi_meta(COALESCE(s.opsi_drop_dari, 'Prospecting'));
      UPDATE deal SET
        stage = COALESCE(s.opsi_drop_dari, 'Prospecting')::deal_stage, loss_status = NULL, loss_reason = NULL,
        prospect_category = m.prospect, probability = m.prob, forecast_category = m.forecast,
        opsi_drop_oleh = NULL, opsi_drop_dari = NULL, stage_entered_at = now(), updated_at = now()
      WHERE deal_id = s.deal_id;
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      VALUES (s.deal_id, 'Closing-Lost', COALESCE(s.opsi_drop_dari, 'Prospecting'), 'system:opsi',
              'dihidupkan lagi: Won Opsi ' || NEW.opsi_no || ' dibatalkan');
    END LOOP;
  END IF;

  -- 3. Rapikan utama (satu per grup).
  SELECT deal_id INTO v_won FROM deal
    WHERE opsi_grup = NEW.opsi_grup AND stage::text = 'Closing-Won' ORDER BY stage_entered_at LIMIT 1;
  SELECT deal_id INTO v_utama FROM deal WHERE opsi_grup = NEW.opsi_grup AND opsi_utama;
  IF v_won IS NOT NULL THEN
    v_buka := v_won;
  ELSIF v_utama IS NOT NULL AND EXISTS (
          SELECT 1 FROM deal WHERE deal_id = v_utama AND stage::text NOT IN ('Closing-Won', 'Closing-Lost')) THEN
    v_buka := v_utama;
  ELSE
    SELECT deal_id INTO v_buka FROM deal
      WHERE opsi_grup = NEW.opsi_grup AND stage::text NOT IN ('Closing-Won', 'Closing-Lost')
      ORDER BY opsi_no LIMIT 1;
    -- Semua tertutup: utama tetap (grup dihitung sekali); kalau belum ada, opsi terkecil
    -- yang bukan di-drop.
    v_buka := COALESCE(v_buka, v_utama, (
      SELECT deal_id FROM deal WHERE opsi_grup = NEW.opsi_grup
      ORDER BY (loss_status = 'dropped') NULLS FIRST, opsi_no LIMIT 1));
  END IF;
  IF v_buka IS DISTINCT FROM v_utama THEN
    UPDATE deal SET opsi_utama = false WHERE opsi_grup = NEW.opsi_grup AND opsi_utama;
    UPDATE deal SET opsi_utama = true WHERE deal_id = v_buka;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS deal_opsi_atur_trg ON deal;
CREATE TRIGGER deal_opsi_atur_trg
  AFTER UPDATE OF stage ON deal
  FOR EACH ROW
  WHEN (NEW.opsi_grup IS NOT NULL AND OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION deal_opsi_atur();
