-- 109: samakan ejaan kanonik brand dgn DAFTAR RESMI dari user (2026-08-18).
--
-- Migrasi 108 menyeragamkan varian ejaan, tapi ejaan kanoniknya masih tebakan
-- ("Zybio", "VivaChek", "Dr. Plus"). User mengirim daftar merek resmi 2 lini
-- (91 entri unik) — itu yang dipakai sekarang: 'ZYBIO', 'VIVACHEK', 'Dr.PLUS'.
--
-- Keputusan user atas 3 titik ambigu:
--   - 'Ediagnosis' TETAP merek sendiri (bukan digabung ke 'Easy Diagnosis').
--   - 'Bipmed' (bukan 'BIPMED') — dua daftar menulisnya beda kapital.
--   - 7 merek yg ADA di data tapi TIDAK ada di daftar resmi (DFI 24 baris,
--     Wiener lab 17, Metrolab 8, Vesmatic 4, EDAN 3, Klyte 2, + Autobio/Boson/
--     Glory/Socorex/Urised/NAM Care/Olympus @1) DIBIARKAN apa adanya — bukan
--     disapu ke 'Lainnya'. Ejaannya tetap seragam, cuma belum masuk daftar resmi.
--
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) yang atur.

-- ── 1) Ganti ejaan kanonik (semua kind ikut: 'brand' maupun 'compound') ──────
UPDATE brand_alias ba
   SET canonical = m.baru
  FROM (VALUES
    ('Abacus', 'ABACUS'), ('AdamLabs', 'ADAMLABS'), ('Biobase', 'BIOBASE'),
    ('Clover', 'CLOVER'), ('Dora', 'DORA'), ('Dr. Plus', 'Dr.PLUS'),
    ('FamilyDr', 'FAMILY DR'), ('Fora', 'FORA'), ('Fujifilm', 'FUJIFILM'),
    ('Healgen', 'HEALGEN'), ('Indoreagen', 'INDOREAGEN'), ('Intec', 'INTEC'),
    ('Konsung', 'KONSUNG'), ('Libiotect', 'LIBIOTECT'), ('Lysun', 'LYSUN'),
    ('Mono', 'MONO'), ('Nuve', 'NUVE'), ('Orgentec', 'ORGENTEC'),
    ('RedCell', 'REDCELL'), ('Sejoy', 'SEJOY'), ('Snibe', 'SNIBE'),
    ('Tcoag', 'TCOAG'), ('Tosoh', 'TOSOH'), ('VivaChek', 'VIVACHEK'),
    ('Wondfo', 'WONDFO'), ('Zybio', 'ZYBIO'), ('iSmart', 'I-SMART'),
    -- daftar resmi menulis 'NIHON' saja, bukan 'Nihon Kohden'
    ('Nihon Kohden', 'NIHON'),
    -- merek sendiri; 'Easy Diagnosis' di daftar resmi dibiarkan sbg entri terpisah
    ('E-Diagnosis', 'Ediagnosis')
  ) AS m(lama, baru)
 WHERE ba.canonical = m.lama;

-- ── 2) Seed seluruh daftar resmi ────────────────────────────────────────────
-- Entri yg belum pernah muncul di data (52 dari 91) sengaja ikut: begitu ada AM
-- mengetiknya, trigger langsung memakai ejaan resmi. Baris 'nonbrand' dilindungi
-- — jangan sampai kunci yg sudah divonis bukan-merek berubah jadi merek.
INSERT INTO brand_alias (alias_key, canonical, kind) VALUES
  ('AKESLING', 'A-Kesling', 'brand'),
  ('ABACUS', 'ABACUS', 'brand'),
  ('ABN', 'ABN', 'brand'),
  ('ADAMLABS', 'ADAMLABS', 'brand'),
  ('AMA', 'AMA', 'brand'),
  ('ARUMAMED', 'ARUMAMED', 'brand'),
  ('BDI', 'BDI', 'brand'),
  ('BIOANALITIKA', 'BIOANALITIKA', 'brand'),
  ('BIOBASE', 'BIOBASE', 'brand'),
  ('BIOCROSS', 'BIOCROSS', 'brand'),
  ('BIPMED', 'Bipmed', 'brand'),
  ('CAREGENE', 'CareGENE', 'brand'),
  ('CARESTART', 'CareStart', 'brand'),
  ('CAREUS', 'CareUS', 'brand'),
  ('CERACHEK', 'Cerachek', 'brand'),
  ('CLOVER', 'CLOVER', 'brand'),
  ('CORNLEY', 'CORNLEY', 'brand'),
  ('DIALINE', 'DIALINE', 'brand'),
  ('DRPLUS', 'Dr.PLUS', 'brand'),
  ('DRX', 'Dr X', 'brand'),
  ('EASYDIAGNOSIS', 'Easy Diagnosis', 'brand'),
  ('ERBA', 'Erba', 'brand'),
  ('FAMILYDR', 'FAMILY DR', 'brand'),
  ('FORA', 'FORA', 'brand'),
  ('FORTRESS', 'FORTRESS', 'brand'),
  ('FUJIFILM', 'FUJIFILM', 'brand'),
  ('GEA', 'GEA', 'brand'),
  ('GEMMY', 'GEMMY', 'brand'),
  ('GIDCARE', 'GIDCARE', 'brand'),
  ('GLOM', 'GLOM', 'brand'),
  ('GLUCODR', 'GLUCO DR', 'brand'),
  ('HEALGEN', 'HEALGEN', 'brand'),
  ('HEMONART', 'Hemonart', 'brand'),
  ('ISMART', 'I-SMART', 'brand'),
  ('INDOREAGEN', 'INDOREAGEN', 'brand'),
  ('INTEC', 'INTEC', 'brand'),
  ('IS', 'IS', 'brand'),
  ('JMITRA', 'J MITRA', 'brand'),
  ('KONSUNG', 'KONSUNG', 'brand'),
  ('KW', 'KW', 'brand'),
  ('LABCARE', 'LAB CARE', 'brand'),
  ('LAMUNO', 'Lamuno', 'brand'),
  ('LAURA', 'LAURA', 'brand'),
  ('LIBIOTECT', 'LIBIOTECT', 'brand'),
  ('LIPIDPRO', 'Lipid Pro', 'brand'),
  ('LYSUN', 'LYSUN', 'brand'),
  ('MERCK', 'MERCK', 'brand'),
  ('MONO', 'MONO', 'brand'),
  ('NIHON', 'NIHON', 'brand'),
  ('ORGENTEC', 'ORGENTEC', 'brand'),
  ('ORIENT', 'ORIENT', 'brand'),
  ('PRIME4DIA', 'Prime4Dia', 'brand'),
  ('QCA', 'QCA', 'brand'),
  ('REDCELL', 'REDCELL', 'brand'),
  ('RIGHTSIGN', 'RIGHT SIGN', 'brand'),
  ('SCLAVO', 'Sclavo', 'brand'),
  ('SD', 'SD', 'brand'),
  ('SEJOY', 'SEJOY', 'brand'),
  ('SEKISUI', 'SEKISUI', 'brand'),
  ('SINOCARE', 'Sinocare', 'brand'),
  ('SNIBE', 'SNIBE', 'brand'),
  ('SUCCEEDER', 'Succeeder', 'brand'),
  ('SZMIC', 'SZMIC', 'brand'),
  ('TCOAG', 'TCOAG', 'brand'),
  ('TOSOH', 'TOSOH', 'brand'),
  ('TUBEX', 'TUBEX', 'brand'),
  ('UNI', 'Uni', 'brand'),
  ('VIVACHEK', 'VIVACHEK', 'brand'),
  ('WITEG', 'WITEG', 'brand'),
  ('WONDFO', 'WONDFO', 'brand'),
  ('XPER', 'XPER', 'brand'),
  ('ZYBIO', 'ZYBIO', 'brand'),
  ('BIOXIL', 'Bioxil', 'brand'),
  ('CHOICEMMED', 'ChoiceM Med', 'brand'),
  ('DOCARE', 'Docare', 'brand'),
  ('DONGA', 'Donga', 'brand'),
  ('DORA', 'DORA', 'brand'),
  ('EASYCARE', 'EasyCare', 'brand'),
  ('FRESENIUS', 'Fresenius', 'brand'),
  ('GOLDEN', 'GOLDEN', 'brand'),
  ('MEDIA', 'Media', 'brand'),
  ('MSUMED', 'Msumed', 'brand'),
  ('NAM', 'Nam', 'brand'),
  ('NUVE', 'NUVE', 'brand'),
  ('ONEHEALTH', 'Onehealth', 'brand'),
  ('ONEJECT', 'Oneject', 'brand'),
  ('ROSSMAX', 'Rossmax', 'brand'),
  ('SANOSIL', 'Sanosil', 'brand'),
  ('SERENITY', 'Serenity', 'brand'),
  ('SYMMEX', 'Symmex', 'brand'),
  ('WEGO', 'WEGO', 'brand')
ON CONFLICT (alias_key) DO UPDATE
   SET canonical = EXCLUDED.canonical, kind = EXCLUDED.kind
 WHERE brand_alias.kind <> 'nonbrand';

-- ── 3) Terapkan ke data ─────────────────────────────────────────────────────
UPDATE deal
   SET brand = norm_brand(brand)
 WHERE brand IS NOT NULL
   AND norm_brand(brand) IS DISTINCT FROM brand;
