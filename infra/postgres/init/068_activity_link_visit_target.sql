-- 068 — F16 Visit Tracker (CRM Fase 1): activity_log di-link ke Account/Opportunity,
-- tipe aktivitas, dan target kunjungan mingguan per AM.
--
-- Latar: activity_log lahir dari WA (#REPORT) dan cuma menyimpan `customer_name`
-- bebas-teks. Akibatnya kunjungan tak bisa di-roll-up ke Account 360 (F62) maupun
-- ke deal pipeline (F1 SPT) — padahal NPK aspek CRM/Presales (F66) & Effort_Factor
-- insentif (F67) butuh hitungan kunjungan per account/opportunity.
--
-- Additive + idempoten. Tanpa FK keras ke accurate_customer/deal: baris lama
-- (~ribuan) punya nama customer yang tak selalu resolvable, dan mirror Accurate
-- bisa di-truncate saat resync — FK akan bikin resync gagal. Konsisten dengan
-- pola deal.account_id (057).
-- CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) atur transaksi.

-- ── 1) Tipe aktivitas kanonik (PRD F3+F16) ──
-- Sengaja TEXT + CHECK, bukan ENUM: daftar tipe masih bisa nambah (mis. 'Tender')
-- dan ALTER TYPE ... ADD VALUE tak bisa jalan di dalam transaksi migrasi.
ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS activity_type  TEXT,
  ADD COLUMN IF NOT EXISTS account_id     BIGINT,   -- soft ref accurate_customer(id)
  ADD COLUMN IF NOT EXISTS opportunity_id UUID;     -- soft ref deal(deal_id)

DO $$ BEGIN
  ALTER TABLE activity_log ADD CONSTRAINT activity_log_type_chk
    CHECK (activity_type IS NULL OR activity_type IN
      ('Fisik','Telepon','WA','Demo','Presentasi','Follow-up'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS activity_log_account_idx     ON activity_log (account_id);
CREATE INDEX IF NOT EXISTS activity_log_opportunity_idx ON activity_log (opportunity_id);
CREATE INDEX IF NOT EXISTS activity_log_type_idx        ON activity_log (activity_type);
-- KPI timeliness (created_at vs tanggal) di-scan per rentang tanggal.
CREATE INDEX IF NOT EXISTS activity_log_tanggal_idx     ON activity_log (tanggal);

-- Backfill tipe untuk baris lama: kunjungan yang plan-nya punya geotag = 'Fisik',
-- sisanya dari WA = 'WA'. Tanpa ini KPI per-tipe bolong untuk seluruh histori.
UPDATE activity_log al SET activity_type = 'Fisik'
WHERE al.activity_type IS NULL
  AND EXISTS (SELECT 1 FROM sales_plan sp WHERE sp.id = al.plan_id AND sp.visit_lat IS NOT NULL);
UPDATE activity_log SET activity_type = 'WA'
WHERE activity_type IS NULL AND source = 'wa-inbound';

-- Backfill account_id dari nama customer (exact-ish, lower+trim). Fuzzy trigram
-- sengaja TIDAK dipakai di migrasi — terlalu lambat untuk full-table dan rawan
-- salah-tempel; resolusi fuzzy dilakukan saat insert baru (repo/inbound.ts).
--
-- Hanya nama yang UNIK di mirror yang dipakai: beberapa faskes punya nama sama
-- persis (cabang berbeda) — tanpa filter unik, UPDATE..FROM memilih baris acak
-- dan kunjungan nempel ke account yang salah.
WITH uniq AS (
  SELECT btrim(lower(COALESCE(NULLIF(ac.name,''), ac.raw->>'name', ''))) AS key,
         min(ac.id) AS id, count(*) AS n
  FROM accurate_customer ac
  GROUP BY 1
  HAVING count(*) = 1
)
UPDATE activity_log al SET account_id = uniq.id
FROM uniq
WHERE al.account_id IS NULL
  AND al.customer_name IS NOT NULL
  AND uniq.key <> ''
  AND btrim(lower(al.customer_name)) = uniq.key;

-- ── 2) Target kunjungan per AM (PRD: 20 kunjungan/minggu, 6 di antaranya prospek baru) ──
-- Baris am_id = '*' adalah default global; baris per-AM meng-override.
CREATE TABLE IF NOT EXISTS visit_target (
  am_id        VARCHAR(50) PRIMARY KEY,             -- '*' = default semua AM
  per_week     INT NOT NULL DEFAULT 20 CHECK (per_week >= 0),
  new_per_week INT NOT NULL DEFAULT 6  CHECK (new_per_week >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO visit_target (am_id, per_week, new_per_week) VALUES ('*', 20, 6)
ON CONFLICT (am_id) DO NOTHING;
