-- 057 — F1 Sales Pipeline Tracker (SPT). Extend `deal` jadi pipeline SPT 8-stage
-- (digitalisasi HS-S-1). Additive: tabel `deal` KOSONG (0 row prod+dev per 2026-07-16)
-- → konversi kolom `stage` (varchar→enum) aman tanpa backfill. Timeline reuse
-- `spt_state_log` (sudah ada). pg_trgm sudah ada (fuzzy account_id di importer).
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) atur transaksi.

-- 1) Enum stage kanonik 8-tahap (urutan = pipeline order).
DO $$ BEGIN
  CREATE TYPE deal_stage AS ENUM (
    'Prospecting', 'First Contact', 'Presentation', 'Quotation',
    'Offering', 'Negotiation', 'Closing-Won', 'Closing-Lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Enum loss_reason (gate deal gagal).
DO $$ BEGIN
  CREATE TYPE deal_loss_reason AS ENUM (
    'harga', 'kompetitor', 'no-budget', 'kalah-tender', 'internal-RS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Konversi kolom `stage` (character varying → deal_stage). deal kosong → USING
--    hanya perlu type-check. Mapping nilai lama (WA-fed) disertakan utk jaga-jaga.
ALTER TABLE deal ALTER COLUMN stage DROP DEFAULT;
ALTER TABLE deal ALTER COLUMN stage TYPE deal_stage USING (
  CASE btrim(lower(coalesce(stage, '')))
    WHEN 'follow up'      THEN 'First Contact'
    WHEN 'first contact'  THEN 'First Contact'
    WHEN 'sph'            THEN 'Quotation'
    WHEN 'quotation'      THEN 'Quotation'
    WHEN 'offering letter' THEN 'Offering'
    WHEN 'offering'       THEN 'Offering'
    WHEN 'presentation'   THEN 'Presentation'
    WHEN 'presentasi'     THEN 'Presentation'
    WHEN 'negotiating'    THEN 'Negotiation'
    WHEN 'negosiasi'      THEN 'Negotiation'
    WHEN 'proses di manajemen' THEN 'Negotiation'
    WHEN 'negotiation'    THEN 'Negotiation'
    WHEN 'deal'           THEN 'Closing-Won'
    WHEN 'mou'            THEN 'Closing-Won'
    WHEN 'closing-won'    THEN 'Closing-Won'
    WHEN 'won'            THEN 'Closing-Won'
    WHEN 'lose'           THEN 'Closing-Lost'
    WHEN 'gagal'          THEN 'Closing-Lost'
    WHEN 'closing-lost'   THEN 'Closing-Lost'
    ELSE 'Prospecting'
  END::deal_stage
);
ALTER TABLE deal ALTER COLUMN stage SET DEFAULT 'Prospecting';

-- customer_id (varchar WA-fed lama) tak wajib utk deal SPT (pakai account_id+facility_name).
ALTER TABLE deal ALTER COLUMN customer_id DROP NOT NULL;
-- am_id boleh NULL: deal HS-S-1 dgn Sales VACANT/tak ter-map di-import tetap (am_id null + tandai).
ALTER TABLE deal ALTER COLUMN am_id DROP NOT NULL;

-- 4) Kolom baru (additive). am_id sudah ada.
ALTER TABLE deal
  -- sumbu & derive-snapshot (kategori/prob/forecast diturunkan dari stage di app-layer)
  ADD COLUMN IF NOT EXISTS prospect_category  TEXT,                       -- Cold/Warm/Hot
  ADD COLUMN IF NOT EXISTS probability        NUMERIC(4,3),               -- 0.000–1.000
  ADD COLUMN IF NOT EXISTS forecast_category  TEXT,                       -- A Commit/B Best/C Pipeline/D Omit/Won/Lost
  ADD COLUMN IF NOT EXISTS stage_entered_at   TIMESTAMPTZ DEFAULT now(),  -- days-in-stage / stale >2mg
  -- produk
  ADD COLUMN IF NOT EXISTS product_category   TEXT,                       -- IVD/Medical
  ADD COLUMN IF NOT EXISTS brand              TEXT,
  ADD COLUMN IF NOT EXISTS product            TEXT,
  ADD COLUMN IF NOT EXISTS parameter          TEXT,
  -- faskes
  ADD COLUMN IF NOT EXISTS facility_name      TEXT,
  ADD COLUMN IF NOT EXISTS instansi_type      TEXT,                       -- RS/Klinik/Puskesmas/Dinkes/Instansi
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS province           TEXT,
  ADD COLUMN IF NOT EXISTS account_id         BIGINT,                     -- soft ref accurate_customer/crm_account (nullable; no hard FK)
  -- kepemilikan / scope
  ADD COLUMN IF NOT EXISTS pic_hod            TEXT,                       -- Rocky/Yogi/Mufid
  ADD COLUMN IF NOT EXISTS cabang             TEXT,                       -- utk scope HOD (resolveScope)
  -- komersial
  ADD COLUMN IF NOT EXISTS coop_model         TEXT,                       -- KSO/Sale
  ADD COLUMN IF NOT EXISTS qty_text           TEXT,
  ADD COLUMN IF NOT EXISTS qty_num            NUMERIC,
  ADD COLUMN IF NOT EXISTS qty_unit           TEXT,
  ADD COLUMN IF NOT EXISTS estimate_amount    NUMERIC,
  ADD COLUMN IF NOT EXISTS pagu_info          TEXT,
  ADD COLUMN IF NOT EXISTS purchase_month     SMALLINT,
  ADD COLUMN IF NOT EXISTS purchase_year      SMALLINT,
  -- terminal / approval (gate Lost)
  ADD COLUMN IF NOT EXISTS loss_reason        deal_loss_reason,
  ADD COLUMN IF NOT EXISTS loss_status        TEXT,                       -- pending/approved
  ADD COLUMN IF NOT EXISTS loss_approved_by   TEXT,
  ADD COLUMN IF NOT EXISTS loss_approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS on_hold            BOOLEAN NOT NULL DEFAULT false;

-- 5) Index utk board/filter + scope.
CREATE INDEX IF NOT EXISTS deal_stage_idx            ON deal (stage);
CREATE INDEX IF NOT EXISTS deal_product_category_idx ON deal (product_category);
CREATE INDEX IF NOT EXISTS deal_am_id_idx            ON deal (am_id);
CREATE INDEX IF NOT EXISTS deal_cabang_idx           ON deal (cabang);
CREATE INDEX IF NOT EXISTS deal_pic_hod_idx          ON deal (pic_hod);
CREATE INDEX IF NOT EXISTS deal_account_id_idx       ON deal (account_id);
-- trigram utk fuzzy match facility_name → accurate_customer (importer).
CREATE INDEX IF NOT EXISTS deal_facility_name_trgm_idx ON deal USING gin (facility_name gin_trgm_ops);

-- 6) Guard idempoten importer (keyed unik lunak — bukan constraint keras, biar impor
--    partial gak gagal; importer pakai NOT EXISTS pada tuple ini).
CREATE INDEX IF NOT EXISTS deal_import_key_idx ON deal (facility_name, brand, product, am_id);
