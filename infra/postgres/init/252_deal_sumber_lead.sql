-- 252 — deal.sumber_lead: asal lead (F96 Kohort & Lead Source).
--
-- Sejak 13 Okt 2026 #LEADS langsung jadi deal, jadi `lead.source` (209) tak
-- terisi lagi. Asal lead dicatat di deal. Lima sumber versi Direktur; NULL =
-- tak dipilih → baris "Lainnya" di F96. 'vendor' = principal/vendor yang
-- merekomendasikan faskes. WA/web BUKAN sumber (itu cara masuk), jadi tak ada
-- di daftar. Lead lama tidak di-backfill.
ALTER TABLE deal ADD COLUMN IF NOT EXISTS sumber_lead text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deal_sumber_lead_chk') THEN
    ALTER TABLE deal ADD CONSTRAINT deal_sumber_lead_chk
      CHECK (sumber_lead IS NULL OR sumber_lead IN ('tender','referensi','vendor','pameran','cold_call'));
  END IF;
END $$;
