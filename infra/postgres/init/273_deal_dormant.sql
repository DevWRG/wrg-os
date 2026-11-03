-- 273: Pipeline Dormant — penanda di ATAS tahap (bukan tahap ke-8).
--
-- Deal yang 45 hari tanpa pergerakan ditandai Dormant (dormant_at) oleh job
-- deal-dormant; tahapnya TIDAK berubah, jadi funnel/forecast/NPK tak terganggu.
-- Bila 15 hari sesudahnya tetap tanpa pergerakan → otomatis Closing-Lost dengan
-- loss_reason 'tidak-bergerak' (loss_status approved, tanpa antrean HoD).
--
-- "Pergerakan" = GREATEST(stage_entered_at, updated_at, entri spt_state_log
-- terakhir yang BUKAN tulisan job ini) — lihat lastActivitySql di repo/deal.ts.
-- Penanda lepas sendiri begitu ada pergerakan sesudah dormant_at (dibaca begitu
-- di read model; job harian ikut membersihkan kolomnya).
--
-- Additive + idempoten. PG16: ADD VALUE boleh di dalam transaksi (psql -1),
-- asal nilai barunya tak DIPAKAI di transaksi yang sama — di sini memang tidak.

ALTER TABLE deal
  ADD COLUMN IF NOT EXISTS dormant_at        TIMESTAMPTZ,  -- mulai Dormant; NULL = tidak
  ADD COLUMN IF NOT EXISTS dormant_wa_am_at  TIMESTAMPTZ,  -- WA "deal Dormant" ke AM terkirim
  ADD COLUMN IF NOT EXISTS dormant_wa_hod_at TIMESTAMPTZ,  -- WA ringkasan ke HoD terkirim
  ADD COLUMN IF NOT EXISTS dormant_ingat_at  TIMESTAMPTZ;  -- WA "segera gugur" (H-3) ke AM terkirim

CREATE INDEX IF NOT EXISTS deal_dormant_at_idx ON deal (dormant_at) WHERE dormant_at IS NOT NULL;

-- Pergerakan terakhir dibaca per deal (max occurred_at) di board & job harian;
-- tabel ini belum punya indeks deal_id sama sekali.
CREATE INDEX IF NOT EXISTS spt_state_log_deal_occurred_idx ON spt_state_log (deal_id, occurred_at DESC);

ALTER TYPE deal_loss_reason ADD VALUE IF NOT EXISTS 'tidak-bergerak';
