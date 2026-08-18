-- 107: seragamkan kolom `deal.brand`.
--
-- Masalah: brand diisi bebas (form Combo free-text + importer menelan apa adanya)
-- sehingga 765 deal menghasilkan 205 nilai brand berbeda — dropdown filter Brand
-- di /pipeline = daftar mentah nilai unik, jadi ikut sepanjang itu. Tiga jenis
-- kekacauan yang ditangani, semuanya dipetakan dari data prod nyata (export
-- 2026-08-18), bukan tebakan:
--
--   1. EJAAN     — 'Zybio'/'ZYBIO'/'zybio'/'Zibio' → satu 'Zybio'. 112 nilai, 634 baris.
--   2. CAMPURAN  — brand berisi barang+merek: 'SPUIT ONJECT' → merek 'Oneject',
--                  teks aslinya diselamatkan ke kolom produk. 20 nilai, 29 baris.
--   3. BUKAN MEREK — brand berisi deskripsi barang ('TENSIMETER DIGITAL', 'ALKES').
--                  73 nilai, 102 baris. Kalau kolom produk baris itu justru berisi
--                  merek dikenali ('SYRINGE'+'ONEJECT') → DITUKAR; sisanya brand
--                  jadi 'Lainnya' dgn teks lama pindah ke produk.
--
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) yang atur.

-- ── 1) Kamus alias ────────────────────────────────────────────────────────────
-- kind: 'brand'    = ejaan varian sebuah merek
--       'compound' = teks barang+merek (perlu penyelamatan teks ke kolom produk)
--       'nonbrand' = bukan merek sama sekali → 'Lainnya'
CREATE TABLE IF NOT EXISTS brand_alias (
  alias_key  TEXT PRIMARY KEY,          -- kunci longgar: huruf+angka, kapital
  canonical  TEXT NOT NULL,             -- ejaan resmi yang ditampilkan
  kind       TEXT NOT NULL DEFAULT 'brand' CHECK (kind IN ('brand', 'compound', 'nonbrand'))
);

-- Kunci pencocokan: buang semua non-alfanumerik lalu kapitalkan. Dengan begitu
-- 'RED CELL', 'REDCELL', 'REdcell', 'red-cell' jatuh ke kunci yang sama tanpa
-- perlu didaftarkan satu per satu.
CREATE OR REPLACE FUNCTION brand_key(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(COALESCE(t, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- Nilai tak dikenal DIBIARKAN (cuma di-trim) — merek baru tidak boleh hilang
-- gara-gara belum terdaftar. STABLE, bukan IMMUTABLE: membaca tabel.
CREATE OR REPLACE FUNCTION norm_brand(t TEXT) RETURNS TEXT
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT ba.canonical FROM brand_alias ba
      WHERE ba.alias_key = brand_key(t) AND ba.kind IN ('brand', 'compound')),
    NULLIF(btrim(COALESCE(t, '')), '')
  );
$$;

INSERT INTO brand_alias (alias_key, canonical, kind) VALUES
  ('ABACUS', 'Abacus', 'brand'),
  ('ABN', 'ABN', 'brand'),
  ('ADAMLABS', 'AdamLabs', 'brand'),
  ('AUTOBIO', 'Autobio', 'brand'),
  ('BDI', 'BDI', 'brand'),
  ('BIOBASE', 'Biobase', 'brand'),
  ('BIOXIL', 'Bioxil', 'brand'),
  ('BIPMED', 'Bipmed', 'brand'),
  ('BOSON', 'Boson', 'brand'),
  ('CARESTART', 'CareStart', 'brand'),
  ('CLOVER', 'Clover', 'brand'),
  ('DFI', 'DFI', 'brand'),
  ('DORA', 'Dora', 'brand'),
  ('DRPLUS', 'Dr. Plus', 'brand'),
  ('EDAN', 'EDAN', 'brand'),
  ('EDIAGNOSIS', 'E-Diagnosis', 'brand'),
  ('ERBA', 'Erba', 'brand'),
  ('FAMILYDR', 'FamilyDr', 'brand'),
  ('FORA', 'Fora', 'brand'),
  ('FRESENIUS', 'Fresenius', 'brand'),
  ('FUJIFILM', 'Fujifilm', 'brand'),
  ('GLORY', 'Glory', 'brand'),
  ('HEALGEN', 'Healgen', 'brand'),
  ('INDOREAGEN', 'Indoreagen', 'brand'),
  ('INTEC', 'Intec', 'brand'),
  ('IS', 'IS', 'brand'),
  ('ISMART', 'iSmart', 'brand'),
  ('KLYTE', 'Klyte', 'brand'),
  ('KONSUNG', 'Konsung', 'brand'),
  ('LIBIOTECT', 'Libiotect', 'brand'),
  ('LYSUN', 'Lysun', 'brand'),
  ('METROLAB', 'Metrolab', 'brand'),
  ('MONO', 'Mono', 'brand'),
  ('NAMCARE', 'NAM Care', 'brand'),
  ('NIHON', 'Nihon Kohden', 'brand'),
  ('NIHONKOHDEN', 'Nihon Kohden', 'brand'),
  ('NUVE', 'Nuve', 'brand'),
  ('OLIMPUS', 'Olympus', 'brand'),
  ('OLYMPUS', 'Olympus', 'brand'),
  ('ONEHEALT', 'Onehealth', 'brand'),
  ('ONEHEALTH', 'Onehealth', 'brand'),
  ('ONEJECT', 'Oneject', 'brand'),
  ('ORGENTEC', 'Orgentec', 'brand'),
  ('REDCELL', 'RedCell', 'brand'),
  ('SANOSIL', 'Sanosil', 'brand'),
  ('SEJOY', 'Sejoy', 'brand'),
  ('SINOCARE', 'Sinocare', 'brand'),
  ('SNIBE', 'Snibe', 'brand'),
  ('SOCOREX', 'Socorex', 'brand'),
  ('SUCCEEDER', 'Succeeder', 'brand'),
  ('SYMMEX', 'Symmex', 'brand'),
  ('TCOAG', 'Tcoag', 'brand'),
  ('TOSOH', 'Tosoh', 'brand'),
  ('URISED', 'Urised', 'brand'),
  ('VESMATIC', 'Vesmatic', 'brand'),
  ('VIVACHEK', 'VivaChek', 'brand'),
  ('WIENERLAB', 'Wiener lab', 'brand'),
  ('WONDFO', 'Wondfo', 'brand'),
  ('WOODPECKER', 'Woodpecker', 'brand'),
  ('ZIBIO', 'Zybio', 'brand'),
  ('ZYBIO', 'Zybio', 'brand'),
  ('BASICMINORSYMMEX', 'Symmex', 'compound'),
  ('CLOVERHBA1C', 'Clover', 'compound'),
  ('COAGULASIZYBIOEXT3800', 'Zybio', 'compound'),
  ('DUSR300', 'Dora', 'compound'),
  ('INSTRUMENTBEDAHSYMMEX', 'Symmex', 'compound'),
  ('INSTRUMETTHTSYMMEX', 'Symmex', 'compound'),
  ('LISADAMLABS', 'AdamLabs', 'compound'),
  ('MINORSETSYMMEX', 'Symmex', 'compound'),
  ('NIHON6510', 'Nihon Kohden', 'compound'),
  ('ONEJECTSYRINGE', 'Oneject', 'compound'),
  ('SANOSILS010', 'Sanosil', 'compound'),
  ('SANOSILS01010L', 'Sanosil', 'compound'),
  ('SANOSILS01025L', 'Sanosil', 'compound'),
  ('SANOSILS0105L', 'Sanosil', 'compound'),
  ('SPUIT10CCONEJECT', 'Oneject', 'compound'),
  ('SPUITONJECT', 'Oneject', 'compound'),
  ('SPUITONJECT3ML5ML', 'Oneject', 'compound'),
  ('SUPUITONEJECT3ML', 'Oneject', 'compound'),
  ('SYMMEXINSTRUMENTCESARSET', 'Symmex', 'compound'),
  ('SYRINGEONEJECT', 'Oneject', 'compound'),
  ('ALATLABUNTUKLABKESDABARU', 'Lainnya', 'nonbrand'),
  ('ALKES', 'Lainnya', 'nonbrand'),
  ('ALKESBEDPASIENSPIROMETERDLL', 'Lainnya', 'nonbrand'),
  ('ALKESPENLIGHTTIMBANGANBERATBADANDANTINGGIBADAN', 'Lainnya', 'nonbrand'),
  ('ALKESSPIROMETERDANTREADMILL', 'Lainnya', 'nonbrand'),
  ('ALKOHOLSWAB', 'Lainnya', 'nonbrand'),
  ('BDRS', 'Lainnya', 'nonbrand'),
  ('BEDPASIENMATRAS', 'Lainnya', 'nonbrand'),
  ('BEDSIDECABINET', 'Lainnya', 'nonbrand'),
  ('BHPK3EDTAMICROTUBE', 'Lainnya', 'nonbrand'),
  ('BLOODBAGTRIPLE', 'Lainnya', 'nonbrand'),
  ('BLOODBANKREFRIGERATOR', 'Lainnya', 'nonbrand'),
  ('BMHP', 'Lainnya', 'nonbrand'),
  ('BMHPBLUETIPDANSPUIT', 'Lainnya', 'nonbrand'),
  ('BMHPBOXSLIDEREAGENZNPARAFILM', 'Lainnya', 'nonbrand'),
  ('BMHPGOLDATUBEXWIDAL', 'Lainnya', 'nonbrand'),
  ('BMHPHEMODIALISA', 'Lainnya', 'nonbrand'),
  ('BSCPAGU73JT', 'Lainnya', 'nonbrand'),
  ('DISPOSIBLESMARTSYRINGE', 'Lainnya', 'nonbrand'),
  ('DISPOSIBLESYRINGE', 'Lainnya', 'nonbrand'),
  ('DOPPLER', 'Lainnya', 'nonbrand'),
  ('DUS', 'Lainnya', 'nonbrand'),
  ('ECG', 'Lainnya', 'nonbrand'),
  ('EKG12CH', 'Lainnya', 'nonbrand'),
  ('GUNTINGBEDAH', 'Lainnya', 'nonbrand'),
  ('HEMODIALISA', 'Lainnya', 'nonbrand'),
  ('INSTRUMENTBEDAH', 'Lainnya', 'nonbrand'),
  ('INSTRUMENTBEDAHBASICMINOR', 'Lainnya', 'nonbrand'),
  ('INSTRUMENTBEDAHSETDANINFANTWARMER', 'Lainnya', 'nonbrand'),
  ('K3EDTATKDN', 'Lainnya', 'nonbrand'),
  ('KURSIBULATBERODA', 'Lainnya', 'nonbrand'),
  ('KURSITUNGGU4SEAT', 'Lainnya', 'nonbrand'),
  ('LARVASIDADBD', 'Lainnya', 'nonbrand'),
  ('LINEN', 'Lainnya', 'nonbrand'),
  ('LINENDANSPREI', 'Lainnya', 'nonbrand'),
  ('LINENTIRAISELIMUTSARUNGBANTAL', 'Lainnya', 'nonbrand'),
  ('LIS', 'Lainnya', 'nonbrand'),
  ('MESINANAESTHESI', 'Lainnya', 'nonbrand'),
  ('MICROPIPETADJUST', 'Lainnya', 'nonbrand'),
  ('MICROSCOPEBINOCULAR', 'Lainnya', 'nonbrand'),
  ('OBAT', 'Lainnya', 'nonbrand'),
  ('PHARMACEUTICALREFRIGERATOR', 'Lainnya', 'nonbrand'),
  ('PNEUMATICTUBE', 'Lainnya', 'nonbrand'),
  ('POTDAHAK', 'Lainnya', 'nonbrand'),
  ('POTURINETUTUPPUTIHNONSTERIL', 'Lainnya', 'nonbrand'),
  ('PRINTERUSG', 'Lainnya', 'nonbrand'),
  ('RAPIDDANBMHPMALARIA', 'Lainnya', 'nonbrand'),
  ('RAPIDDENGUE', 'Lainnya', 'nonbrand'),
  ('RAPIDHBSAGDANHIV', 'Lainnya', 'nonbrand'),
  ('RAPIDHIV', 'Lainnya', 'nonbrand'),
  ('RAPIDHIVSYPHILIS', 'Lainnya', 'nonbrand'),
  ('RAPIDTESTHB', 'Lainnya', 'nonbrand'),
  ('REAGENGOLONGANDARAHAKD', 'Lainnya', 'nonbrand'),
  ('REAGENPROFILELIPIDAKD', 'Lainnya', 'nonbrand'),
  ('SCALLERGIGI', 'Lainnya', 'nonbrand'),
  ('SPIROMETER', 'Lainnya', 'nonbrand'),
  ('SPUIT05ML', 'Lainnya', 'nonbrand'),
  ('SPUIT135ML', 'Lainnya', 'nonbrand'),
  ('SPUIT3CC', 'Lainnya', 'nonbrand'),
  ('SPUIT3ML', 'Lainnya', 'nonbrand'),
  ('SUCTIONPUMPBAYIAKD', 'Lainnya', 'nonbrand'),
  ('SYRINGE', 'Lainnya', 'nonbrand'),
  ('SYRINGEPUMP', 'Lainnya', 'nonbrand'),
  ('TABUNGREAKSI', 'Lainnya', 'nonbrand'),
  ('TASEMERGENCY', 'Lainnya', 'nonbrand'),
  ('TCM', 'Lainnya', 'nonbrand'),
  ('TENSIMETERANEROID', 'Lainnya', 'nonbrand'),
  ('TENSIMETERDANSTETHOSCOPE', 'Lainnya', 'nonbrand'),
  ('TENSIMETERDIGITAL', 'Lainnya', 'nonbrand'),
  ('TENSIMETERDIGITALCHARGER', 'Lainnya', 'nonbrand'),
  ('TIMBANGANBAYIDANTIMBANGANDEWASA', 'Lainnya', 'nonbrand'),
  ('VACCINESTORAGE28C', 'Lainnya', 'nonbrand'),
  ('VEINFINDER', 'Lainnya', 'nonbrand')
ON CONFLICT (alias_key) DO UPDATE SET canonical = EXCLUDED.canonical, kind = EXCLUDED.kind;

-- ── 2) Pembersihan data lama (sekali jalan, urutannya penting) ───────────────

-- 2a. CAMPURAN: selamatkan teks aslinya ke kolom produk SEBELUM brand ditimpa
--     merek kanonik. Kalau produk sudah terisi, biarkan — jangan menimpa isian AM.
UPDATE deal d
   SET product = btrim(d.brand)
 WHERE NULLIF(btrim(COALESCE(d.product, '')), '') IS NULL
   AND EXISTS (SELECT 1 FROM brand_alias b
                WHERE b.alias_key = brand_key(d.brand) AND b.kind = 'compound');

-- 2b. TUKAR: brand berisi nama barang sementara merek-nya nyasar ke kolom produk
--     ('SYRINGE' + 'ONEJECT'). Dua-duanya dipindah ke tempat yang benar.
UPDATE deal d
   SET brand   = norm_brand(d.product),
       product = btrim(d.brand)
 WHERE EXISTS (SELECT 1 FROM brand_alias b
                WHERE b.alias_key = brand_key(d.brand) AND b.kind = 'nonbrand')
   AND EXISTS (SELECT 1 FROM brand_alias b2
                WHERE b2.alias_key = brand_key(d.product) AND b2.kind IN ('brand', 'compound'));

-- 2c. LAINNYA: sisa baris bukan-merek. Teks lamanya pindah ke produk kalau produk
--     masih kosong — deskripsi barang jangan sampai hilang, cuma pindah kolom.
UPDATE deal d
   SET product = COALESCE(NULLIF(btrim(COALESCE(d.product, '')), ''), btrim(d.brand)),
       brand   = 'Lainnya'
 WHERE EXISTS (SELECT 1 FROM brand_alias b
                WHERE b.alias_key = brand_key(d.brand) AND b.kind = 'nonbrand');

-- 2d. EJAAN: seragamkan sisanya.
UPDATE deal
   SET brand = norm_brand(brand)
 WHERE brand IS NOT NULL
   AND norm_brand(brand) IS DISTINCT FROM brand;

-- ── 3) Jaga ke depan ─────────────────────────────────────────────────────────
-- Input brand SENGAJA tetap bebas (AM tidak dipaksa memilih dari daftar), jadi
-- penyeragaman dilakukan di tulis-DB lewat trigger. Efeknya SEMUA jalur ikut
-- rapi tanpa aturan yang digandakan di API/importer/WA — konsekuensinya: nilai
-- brand bisa berubah sendiri saat disimpan. Itu disengaja; lihat CLAUDE.md.
-- Baris bukan-merek TIDAK disapu trigger ke 'Lainnya' (butuh pemindahan teks ke
-- kolom produk, yang tak aman ditebak per baris) — itu tetap kerja sekali-jalan.
CREATE OR REPLACE FUNCTION deal_brand_norm() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.brand := norm_brand(NEW.brand);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_brand_norm_trg ON deal;
CREATE TRIGGER deal_brand_norm_trg
  BEFORE INSERT OR UPDATE OF brand ON deal
  FOR EACH ROW EXECUTE FUNCTION deal_brand_norm();
