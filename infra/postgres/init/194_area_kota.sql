-- 194 — Area faktur tanpa AM (OFFICE / VACANT) ikut LOKASI customer.
--
-- Keputusan user 6 Okt 2026: di sudut pandang PER CABANG tidak boleh ada baris
-- "Office" — revenue tetap melekat ke area. "OFFICE" hanya label SALES untuk
-- faktur yang belum punya nama sales. Faktur ber-AM tetap ikut cabang AM pada
-- tanggal faktur (193); faktur tanpa AM tak punya cabang AM, jadi area-nya
-- diturunkan dari kota customer.
--
-- Kota dibaca dari nama customer Accurate (format "INTI, JENIS KOTA/KAB"),
-- dicocokkan ke tabel ini. Tabel TERPISAH dari master_territory dengan sengaja:
-- master_territory juga mengelompokkan AM per HoD di dashboard plan
-- (plandash.ts), jadi menambah baris kota di sana bisa membuat AM tampil di
-- dua HoD. Nama cabang di sini mengikuti penamaan dashboard (master_user /
-- hod_territory: SBY 2, SOLO & YOGYAKARTA, CIREBON), bukan penamaan
-- master_territory (SURABAYA 2, JAWA TENGAH, JAWA BARAT).

CREATE TABLE IF NOT EXISTS area_kota (
  kota        text PRIMARY KEY,           -- huruf besar, mis. 'KOTA JAKARTA SELATAN'
  cabang      text NOT NULL,
  catatan     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 1) Salin peta yang sudah ada dari master_territory, nama cabang diseragamkan.
INSERT INTO area_kota (kota, cabang, catatan)
SELECT DISTINCT ON (upper(btrim(kota))) upper(btrim(kota)),
       CASE upper(btrim(cabang))
         WHEN 'SURABAYA 2'  THEN 'SBY 2'
         WHEN 'JAWA TENGAH' THEN 'SOLO & YOGYAKARTA'
         WHEN 'JAWA BARAT'  THEN 'CIREBON'
         ELSE upper(btrim(cabang)) END,
       'dari master_territory'
FROM master_territory
ORDER BY upper(btrim(kota)), created_at DESC
ON CONFLICT (kota) DO NOTHING;

-- 2) Kota baru (keputusan user 6 Okt 2026).
--    Jabodetabek + Banten + Lampung → JAKARTA.
--    Kalimantan + Sulawesi → SBY 1 (area baru, region OFFICE / tanpa HoD).
--    DIY → SOLO & YOGYAKARTA.
--    Catatan: KOTA BANJAR = Jawa Barat (bukan Kalimantan) — sengaja tak masuk.
INSERT INTO area_kota (kota, cabang, catatan) VALUES
  ('KOTA JAKARTA PUSAT',      'JAKARTA', 'Jabodetabek'),
  ('KOTA JAKARTA SELATAN',    'JAKARTA', 'Jabodetabek'),
  ('KOTA JAKARTA TIMUR',      'JAKARTA', 'Jabodetabek'),
  ('KOTA JAKARTA BARAT',      'JAKARTA', 'Jabodetabek'),
  ('KOTA JAKARTA UTARA',      'JAKARTA', 'Jabodetabek'),
  ('KOTA DEPOK',              'JAKARTA', 'Jabodetabek'),
  ('KOTA BEKASI',             'JAKARTA', 'Jabodetabek'),
  ('KOTA BEKASI BARAT',       'JAKARTA', 'Jabodetabek'),
  ('KAB. BEKASI',             'JAKARTA', 'Jabodetabek'),
  ('KOTA BOGOR',              'JAKARTA', 'Jabodetabek'),
  ('KAB. BOGOR',              'JAKARTA', 'Jabodetabek'),
  ('KOTA TANGERANG',          'JAKARTA', 'Jabodetabek'),
  ('KOTA TANGERANG SELATAN',  'JAKARTA', 'Jabodetabek'),
  ('KAB. TANGERANG',          'JAKARTA', 'Jabodetabek'),
  ('KOTA SERANG',             'JAKARTA', 'Banten'),
  ('KAB. SERANG',             'JAKARTA', 'Banten'),
  ('KAB. PANDEGLANG',         'JAKARTA', 'Banten'),
  ('KAB. LEBAK',              'JAKARTA', 'Banten'),
  ('KOTA CILEGON',            'JAKARTA', 'Banten'),
  ('KOTA BANDAR LAMPUNG',     'JAKARTA', 'Lampung'),
  ('KAB. LAMPUNG UTARA',      'JAKARTA', 'Lampung'),
  ('KOTA BANJARMASIN',        'SBY 1',   'Kalimantan'),
  ('KOTA BANJARBARU',         'SBY 1',   'Kalimantan'),
  ('KAB. BANJAR',             'SBY 1',   'Kalimantan'),
  ('KAB. TABALONG',           'SBY 1',   'Kalimantan'),
  ('KOTA SAMARINDA',          'SBY 1',   'Kalimantan'),
  ('KOTA BALIKPAPAN',         'SBY 1',   'Kalimantan'),
  ('KOTA PONTIANAK',          'SBY 1',   'Kalimantan'),
  ('KOTA PALANGKARAYA',       'SBY 1',   'Kalimantan'),
  ('KOTA MAKASSAR',           'SBY 1',   'Sulawesi'),
  ('KAB. GOWA',               'SBY 1',   'Sulawesi'),
  ('KOTA MANADO',             'SBY 1',   'Sulawesi'),
  ('KOTA PALU',               'SBY 1',   'Sulawesi'),
  -- DIY: belum ada di master_territory; wilayahnya jelas SOLO & YOGYAKARTA.
  ('KAB. SLEMAN',             'SOLO & YOGYAKARTA', 'DIY'),
  ('KOTA YOGYAKARTA',         'SOLO & YOGYAKARTA', 'DIY'),
  ('KAB. KULON PROGO',        'SOLO & YOGYAKARTA', 'DIY'),
  ('KAB. BANTUL',             'SOLO & YOGYAKARTA', 'DIY')
ON CONFLICT (kota) DO NOTHING;

-- 3) Area customer: kota dari nama customer → area_kota; fallback cabang AM
--    pemilik akun (crm_account.owner_am_id). NULL bila dua-duanya tak ada.
CREATE OR REPLACE FUNCTION area_customer(p_customer_id bigint) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ak.cabang FROM accurate_customer c
       JOIN area_kota ak ON ak.kota = upper(btrim(substring(c.name from '((?:KAB\.|KOTA ADM\.|KOTA) [A-Za-z .\-]+)$')))
      WHERE c.id = p_customer_id),
    (SELECT NULLIF(mu.cabang,'') FROM crm_account ca JOIN master_user mu ON mu.am_id = ca.owner_am_id
      WHERE ca.account_id = p_customer_id)
  )
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON area_kota TO wrg_app;
    GRANT EXECUTE ON FUNCTION area_customer(bigint) TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON area_kota TO wrg_readonly;
    GRANT EXECUTE ON FUNCTION area_customer(bigint) TO wrg_readonly;
  END IF;
END $$;
