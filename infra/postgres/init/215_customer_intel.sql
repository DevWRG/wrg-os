-- 215 — F131 Customer Intelligence + Competitor Watch.
--
-- Keputusan user (2026-10-13):
--   • Briefing pra-kunjungan per faskes lewat WA #BRIEF + panel Accounts 360;
--     FAKTA saja (tanpa LLM).
--   • Kompetitor eksklusif per wilayah: deteksi otomatis (dominasi sebutan per
--     cabang × kategori) + KONFIRMASI HoD → tabel competitor_dominan.
--   • Sinyal anggaran Dinkes: ditunda.
--
-- Temuan prod 13 Okt: 625 dari 1.918 sebutan competitor_intel (33%) ternyata
-- BRAND WAHANA SENDIRI (Zybio 158, Wondfo 129, Vivachek 101) — prompt ekstraksi
-- hanya mengecualikan 6 brand. Daftar brand sendiri kini diturunkan dari faktur
-- (brand_sendiri, 24 bln terakhir, via item_brand migrasi 214) dan dipakai untuk
-- memisahkan sebutan brand sendiri dari kompetitor sungguhan.
--
-- competitor_intel juga tak punya tautan ke faskes (cuma customer_name teks).
-- Ditambah activity_id + account_id; sebutan lama ditautkan balik ke laporan
-- asalnya bila cocok TUNGGAL (am_id, tanggal, customer_name) — 1.569/1.680 di
-- prod; account_id ikut dari activity_log (baru ~320 karena #REPORT lama
-- jarang tertaut akun — briefing juga mencocokkan lewat nama faskes).
-- Additive & idempoten.

-- Ejaan yang tercecer di sebutan lapangan (alias kanonik yang sudah ada).
INSERT INTO brand_alias (alias_key, canonical, kind)
SELECT 'VIVACHECK', ba.canonical, 'brand' FROM brand_alias ba WHERE ba.alias_key = 'VIVACHEK' AND ba.kind = 'brand'
ON CONFLICT (alias_key) DO NOTHING;

-- Nama vendor seragam: buang badan usaha di depan ("PT Saba" = "Saba"), lalu
-- norm_brand (alias brand kanonik). Unknown/kosong → NULL.
CREATE OR REPLACE FUNCTION norm_vendor(t text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN v IS NULL OR upper(v) IN ('UNKNOWN', 'TIDAK DIKETAHUI', '-') THEN NULL ELSE norm_brand(v) END
  FROM (SELECT NULLIF(btrim(regexp_replace(btrim(COALESCE(t, '')), '^(PT|CV|UD)[.]?[[:space:]]+', '', 'i')), '') AS v) s
$$;

-- Brand yang dijual Wahana (muncul di faktur 24 bln terakhir). Disegarkan oleh
-- aplikasi (segarkanBrandSendiri, sebelum job ekstraksi kompetitor) — tabel
-- biasa, bukan materialized view, supaya role aplikasi (DML-only) bisa mengisi.
CREATE TABLE IF NOT EXISTS brand_sendiri (
  brand         text PRIMARY KEY,
  terakhir      date,
  diperbarui_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO brand_sendiri (brand, terakhir)
SELECT b.brand, max(b.tanggal)
FROM (
  SELECT item_brand(x.item_id) AS brand, x.tanggal
  FROM (SELECT aii.item_id, max(ai.tanggal) AS tanggal
        FROM accurate_invoice_item aii JOIN accurate_invoice ai ON ai.id = aii.invoice_id
        WHERE ai.tanggal >= current_date - interval '24 months'
        GROUP BY aii.item_id) x
) b
WHERE b.brand IS NOT NULL
GROUP BY b.brand
ON CONFLICT (brand) DO UPDATE SET terakhir = EXCLUDED.terakhir, diperbarui_at = now();

ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS activity_id bigint;
ALTER TABLE competitor_intel ADD COLUMN IF NOT EXISTS account_id  bigint;  -- soft ref accurate_customer
CREATE INDEX IF NOT EXISTS idx_ci_account ON competitor_intel (account_id) WHERE account_id IS NOT NULL;

-- Tautkan balik sebutan hasil ekstraksi ke laporan asalnya — hanya bila cocok
-- TUNGGAL; yang ganda dibiarkan kosong (lebih baik tak tertaut daripada salah).
UPDATE competitor_intel ci
SET activity_id = m.id, account_id = m.account_id
FROM (
  SELECT ci2.id AS ci_id, min(al.id) AS id, min(al.account_id) AS account_id
  FROM competitor_intel ci2
  JOIN activity_log al ON al.am_id = ci2.am_id AND al.tanggal = ci2.tanggal AND al.customer_name = ci2.customer_name
  WHERE ci2.source = 'extract' AND ci2.activity_id IS NULL
  GROUP BY ci2.id
  HAVING count(*) = 1
) m
WHERE ci.id = m.ci_id;

-- Konfirmasi HoD atas "dugaan dominan" (satu vendor menguasai sebutan di satu
-- cabang × kategori). Satu baris per (cabang, kategori, vendor).
CREATE TABLE IF NOT EXISTS competitor_dominan (
  cabang     text NOT NULL,
  kategori   text NOT NULL,
  vendor     text NOT NULL,
  status     text NOT NULL CHECK (status IN ('dikonfirmasi', 'ditolak')),
  catatan    text,
  oleh       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabang, kategori, vendor)
);

COMMENT ON TABLE competitor_dominan IS
  'F131: konfirmasi HoD atas dugaan kompetitor dominan/eksklusif per cabang × kategori (deteksi dari competitor_intel). Keputusan user 13 Okt 2026.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON brand_sendiri, competitor_dominan TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON brand_sendiri, competitor_dominan TO wrg_readonly;
  END IF;
END $$;
