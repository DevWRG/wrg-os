-- 112 — seragamkan `kso_asset.type_alat` jadi JENIS ALAT kanonik.
--
-- Dua cacat yang muncul saat revenue KSO dipecah per jenis alat (2026-08-19):
--
--   1. DUPLIKAT BESAR-KECIL. Ada 'Immunology' (7 aset) DAN 'IMMUNOLOGY' (1 aset,
--      DNM-9602). Keduanya jenis yang sama, tapi terhitung terpisah: yang huruf besar
--      mendapat 770 tes dengan revenue Rp 0, karena nama item `PEMERIKSAAN IMMUNOLOGY
--      MUREX` memetakan revenue-nya ke ejaan yang satu lagi. Rp/tes-nya jadi 0 —
--      dirender sebagai angka, bukan sebagai error.
--   2. ANALYZER vs SEMI TIDAK BISA DIPISAH DARI DATA FAKTUR. Reagen kimia klinik dipakai
--      bergantian oleh 'Kimia Klinik Analyzer' dan 'Kimia Klinik Semi', dan faktur tidak
--      menyebut mesin mana yang memakainya. Akibatnya hampir seluruh reagen kimia jatuh
--      ke Analyzer: Semi cuma kebagian Rp 2 jt untuk 2.599 tes = Rp 804/tes, sementara
--      Analyzer Rp 9.124/tes. Angka Semi itu bukan temuan produktivitas, itu artefak
--      pembagian. Digabung jadi satu jenis 'Kimia Klinik' (ditetapkan user 2026-08-19).
--
-- KENAPA TABEL ALIAS, BUKAN `UPDATE kso_asset SET type_alat = ...`:
-- `type_alat` diisi dari spreadsheet lewat scripts/ops/kso-asset-import.mjs, yang
-- ON CONFLICT-nya menimpa kolom itu (`type_alat = EXCLUDED.type_alat`). UPDATE manual
-- akan hilang diam-diam pada impor berikutnya — tanpa error, tanpa jejak. Polanya
-- disamakan dengan brand_alias (108): kunci longgar + tabel kamus.
--
-- `type_alat` SENGAJA TIDAK DIUBAH dan tetap jadi kebenaran per-aset. Yang ditambahkan
-- adalah lapisan pengelompokan. Sebuah alat yang memang 'Kimia Klinik Semi' tetap
-- tertulis begitu di detail aset; yang berubah hanya cara menjumlahkannya.

CREATE TABLE IF NOT EXISTS kso_jenis_alat_alias (
  alias_key TEXT PRIMARY KEY,   -- type_alat dinormalisasi: alfanumerik saja, kapital
  canonical TEXT NOT NULL,      -- jenis yang dipakai untuk mengelompokkan
  catatan   TEXT
);

COMMENT ON TABLE kso_jenis_alat_alias IS
  'Peta type_alat (apa adanya dari spreadsheet) -> jenis alat kanonik untuk pengelompokan. Kunci = huruf+angka saja, dikapitalkan, sehingga beda besar-kecil/spasi jatuh ke satu kunci. Sumber kebenaran pengelompokan jenis alat; type_alat sendiri tetap mentah karena ditimpa importer.';

-- Kunci longgar: buang non-alfanumerik lalu kapitalkan. 'Immunology' dan 'IMMUNOLOGY'
-- otomatis jatuh ke kunci yang sama, jadi duplikat besar-kecil apa pun yang muncul kelak
-- ikut tertangkap tanpa perlu barisnya ditambah satu per satu.
CREATE OR REPLACE FUNCTION kso_jenis_alias_key(p_type_alat text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_type_alat,''), '[^a-zA-Z0-9]', '', 'g')), '')
$$;

-- CADANGAN KE NILAI ASLINYA, BUKAN KE NULL — ini pagarnya. Kalau spreadsheet kelak memuat
-- jenis alat baru yang belum ada di kamus, alat itu tetap muncul dengan namanya sendiri.
-- Kalau dicadangkan ke NULL, jenis baru akan LENYAP dari setiap pengelompokan tanpa satu
-- pun error — persis kelas kesalahan yang migrasi ini perbaiki.
CREATE OR REPLACE FUNCTION kso_jenis_kanonik(p_type_alat text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.canonical FROM kso_jenis_alat_alias a
      WHERE a.alias_key = kso_jenis_alias_key(p_type_alat)),
    NULLIF(btrim(COALESCE(p_type_alat,'')), '')
  )
$$;

COMMENT ON FUNCTION kso_jenis_kanonik(text) IS
  'type_alat -> jenis alat kanonik. Nilai yang belum ada di kso_jenis_alat_alias dikembalikan apa adanya (bukan NULL) supaya jenis baru dari spreadsheet tidak hilang diam-diam dari pengelompokan.';

-- Seed = 17 nilai type_alat yang ada di prod per 2026-08-19. Ejaan tampilan sengaja
-- DIPERTAHANKAN apa adanya kecuali pada dua kasus yang memang harus digabung, supaya
-- migrasi ini tidak diam-diam mengganti label yang sudah dikenal pengguna.
INSERT INTO kso_jenis_alat_alias (alias_key, canonical, catatan) VALUES
  ('BDRS',                'BDRS',             NULL),
  ('BGA',                 'BGA',              NULL),
  ('COAGULASI',           'Coagulasi',        NULL),
  ('ELEKTROLITE',         'Elektrolite',      NULL),
  ('HEMATOLOGY3DIFF',     'Hematology 3Diff', NULL),
  ('HEMATOLOGY5DIFF',     'Hematology 5Diff', NULL),
  ('HEMODIALISA',         'Hemodialisa',      NULL),
  ('IMMUNOLOGY',          'Immunology',       'gabungan Immunology (7 aset) + IMMUNOLOGY (1 aset); kunci longgar menyatukan keduanya'),
  ('KIMIAKLINIKANALYZER', 'Kimia Klinik',     'digabung dgn Semi: faktur tidak menyebut mesin pemakai reagen'),
  ('KIMIAKLINIKSEMI',     'Kimia Klinik',     'digabung dgn Analyzer: pemisahannya artefak, bukan produktivitas'),
  ('LED',                 'LED',              NULL),
  ('PCR',                 'PCR',              NULL),
  ('POCT',                'POCT',             NULL),
  ('POCTCLOVER',          'POCT Clover',      NULL),
  ('POCTIMMUNOLOGY',      'POCT IMMUNOLOGY',  'TETAP terpisah dari Immunology: alat POCT, bukan analyzer immunoassay'),
  ('URINALYZER',          'URINALYZER',       NULL)
ON CONFLICT (alias_key) DO UPDATE
  SET canonical = EXCLUDED.canonical, catatan = EXCLUDED.catatan;

-- Deteksi jenis baru yang belum masuk kamus (harus nol setelah migrasi ini):
--   SELECT DISTINCT a.type_alat FROM kso_asset a
--   LEFT JOIN kso_jenis_alat_alias k ON k.alias_key = kso_jenis_alias_key(a.type_alat)
--   WHERE a.type_alat IS NOT NULL AND k.alias_key IS NULL;
