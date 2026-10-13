-- 214 — F74 Non-KSO Field Campaign Tracker (menyerap F46 Bulk Import Campaign).
--
-- Keputusan user (2026-10-13):
--   • F74 menyerap F46 — satu modul kampanye (gaya "Vivachek 5000 box").
--   • Atribusi OTOMATIS per brand/produk + periode + jalur non-KSO: AM tak perlu
--     menandai lead/deal/faktur. Kampanye = daftar brand + (opsional) item
--     Accurate tertentu; baris faktur/SO non-KSO yang item-nya cocok dalam
--     periode kampanye = realisasi.
--   • Target per AM: Rupiah NETTO (wajib, basis sama dgn Sales Analytics) +
--     qty opsional.
--   • Dibuat & dipantau di menu web; WA #KAMPANYE hanya membaca progres.
--
-- Brand per item Accurate TIDAK ada di mana pun sebelumnya (Sales Analytics tak
-- pernah memetakan brand). item_brand() menurunkannya berurutan:
--   1. Klasifikasi Produk (product_code.brand, tertaut accurate_item_id)
--   2. Price Book (product_pricelist.brand, kode = accurate_item.no, periode terbaru)
--   3. alias brand di NAMA item (kata mana pun, termasuk dua kata berurutan
--      mis. "FAMILY DR") — nama_brand().
-- Ukur di data dev (12 bln s/d Agu 2026): cakupan netto non-KSO 70% (1) →
-- 77,7% (1+2+kata pertama) → 83,4% (+ kata mana pun); antar-sumber bertentangan
-- hanya Rp 4 jt. Sisanya ditutup lewat campaign_item (pilih item manual).
-- Additive & idempoten.

-- Alias brand di nama item. Token = potongan huruf/angka/titik ("DR.PLUS" utuh);
-- dua kata berurutan dicoba DULU pada posisi yang sama (lebih spesifik), lalu
-- satu kata. Kunci < 3 huruf diabaikan (alias pendek mis. "IS" terlalu bising).
CREATE OR REPLACE FUNCTION nama_brand(t text) RETURNS text LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT tok, pos, lead(tok) OVER (ORDER BY pos) AS nxt
    FROM regexp_split_to_table(upper(COALESCE(t, '')), '[^A-Z0-9.]+') WITH ORDINALITY AS s(tok, pos)
    WHERE tok <> ''
  )
  SELECT ba.canonical
  FROM w
  CROSS JOIN LATERAL (VALUES (1, CASE WHEN w.nxt IS NULL THEN NULL ELSE brand_key(w.tok || w.nxt) END),
                             (2, brand_key(w.tok))) AS k(pri, kunci)
  JOIN brand_alias ba ON ba.alias_key = k.kunci AND ba.kind IN ('brand', 'compound')
  WHERE length(k.kunci) >= 3
  ORDER BY w.pos, k.pri
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION item_brand(p_item_id bigint) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT norm_brand(pc.brand) FROM product_code pc
      WHERE pc.accurate_item_id = p_item_id AND NULLIF(btrim(pc.brand), '') IS NOT NULL
      ORDER BY pc.kode LIMIT 1),
    (SELECT norm_brand(pp.brand) FROM accurate_item it JOIN product_pricelist pp ON pp.kode = it.no
      WHERE it.id = p_item_id AND NULLIF(btrim(pp.brand), '') IS NOT NULL
      ORDER BY pp.periode DESC LIMIT 1),
    (SELECT nama_brand(it.name) FROM accurate_item it WHERE it.id = p_item_id))
$$;

CREATE SEQUENCE IF NOT EXISTS campaign_kode_seq START 1;

CREATE TABLE IF NOT EXISTS campaign (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode            text NOT NULL UNIQUE DEFAULT ('KMP-' || lpad(nextval('campaign_kode_seq')::text, 4, '0')),
  nama            text NOT NULL CHECK (btrim(nama) <> ''),
  deskripsi       text,
  tanggal_mulai   date NOT NULL,
  tanggal_selesai date NOT NULL,
  satuan_qty      text,                       -- label target qty (mis. "box"); NULL = tanpa target qty
  dibatalkan      boolean NOT NULL DEFAULT false,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (tanggal_selesai >= tanggal_mulai)
);

-- Brand kanonik (hasil norm_brand) yang masuk kampanye.
CREATE TABLE IF NOT EXISTS campaign_brand (
  campaign_id bigint NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  brand       text NOT NULL,
  PRIMARY KEY (campaign_id, brand)
);

-- Item Accurate tambahan (yang brand-nya tak terpetakan, atau kampanye 1 SKU).
CREATE TABLE IF NOT EXISTS campaign_item (
  campaign_id bigint NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  item_id     bigint NOT NULL REFERENCES accurate_item(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, item_id)
);

CREATE TABLE IF NOT EXISTS campaign_target (
  campaign_id bigint NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  am_id       text NOT NULL,
  target_rp   numeric(18,2) NOT NULL CHECK (target_rp >= 0),
  target_qty  numeric(14,2) CHECK (target_qty IS NULL OR target_qty >= 0),
  PRIMARY KEY (campaign_id, am_id)
);

CREATE INDEX IF NOT EXISTS campaign_periode_idx ON campaign (tanggal_mulai, tanggal_selesai) WHERE NOT dibatalkan;

COMMENT ON TABLE campaign IS
  'F74 Campaign Tracker (menyerap F46): kampanye non-KSO per brand/item + periode; realisasi dihitung otomatis dari faktur/SO non-KSO (item_brand). Keputusan user 13 Okt 2026.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON campaign, campaign_brand, campaign_item, campaign_target TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE campaign_kode_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON campaign, campaign_brand, campaign_item, campaign_target TO wrg_readonly;
  END IF;
END $$;
