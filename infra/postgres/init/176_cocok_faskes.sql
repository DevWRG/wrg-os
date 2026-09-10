-- 176_cocok_faskes.sql — predikat "dua nama ini faskes yang sama?"
--
-- LATAR
-- Pencocokan #REPORT ke sales_plan memakai pg_trgm `similarity() > 0.3` pada
-- nama UTUH. Nama faskes Indonesia hampir selalu berbentuk
--     <kata generik> <nama pembeda> <nama tempat>
-- sehingga dua faskes yang BERBEDA di kota yang sama sudah melewati 0,3 hanya
-- dari bagian yang mereka bagi bersama:
--
--     similarity('Puskesmas Peterongan','Puskesmas Jabon')   = 0,32
--     similarity('RS nu babat','Rs permata bunda babat')     = 0,36
--     similarity('rsu muh babat','Rs nu babat')              = 0,44
--
-- Yang terakhir itu dua rumah sakit berbeda di Babat — RSU Muhammadiyah dan
-- RS NU — dan 0,44 lolos dengan lapang.
--
-- Akibatnya dua arah sekaligus: kunjungan nyata dikreditkan ke customer yang
-- salah, DAN rencana yang tak dikunjungi tercatat sudah dilaporkan. Terhitung
-- di produksi: 34 tautan salah faskes, 41 rencana bertanda reported palsu.
--
-- ATURAN
-- Buang kata generik, lalu buang bagian yang SAMA (biasanya nama kota), dan
-- nilai hanya SISA-nya — bagian yang benar-benar membedakan:
--
--     'rsu muh babat' vs 'Rs nu babat'  →  inti 'muh babat' vs 'nu babat'
--                                       →  sisa 'muh'       vs 'nu'      → TOLAK
--
-- Tiga jalan keluar menjaga agar varian penulisan yang sah tetap diterima:
--   1. similarity nama utuh >= 0,5  → salah eja ('ulu 1' vs 'unit 1' = 0,65,
--      'Laboratorium Samudera' vs 'Laboratorium Samudra Medika' = 0,53)
--   2. inti salah satu memuat inti yang lain → singkatan/perluasan
--      ('RS PHC' ⊂ 'RS PHC Surabaya', 'Pkm Pladju' ↔ 'Puskesmas Pladju')
--   3. inti kosong setelah pembuangan → jatuh kembali ke aturan lama
--
-- DIUKUR pada 3.418 tautan report↔plan yang ada di produksi: 3.389 tetap
-- diterima, 29 ditolak — dan tiap satu dari 29 itu sudah diperiksa manual
-- sebagai faskes yang memang berbeda.

-- Nama tanpa prefiks `Cust :` — 834 baris activity_log membawanya, dan prefiks
-- itu ikut dihitung pg_trgm sehingga menggerus skor terhadap nama plan yang
-- bersih. Disediakan sebagai fungsi supaya pemanggil di TypeScript tak perlu
-- menulis regex ber-backslash di dalam template literal: di sana `\s` luruh
-- jadi `s` secara diam-diam dan polanya berhenti cocok tanpa error.
CREATE OR REPLACE FUNCTION faskes_bersih(s text) RETURNS text AS $$
  SELECT btrim(regexp_replace(COALESCE(s,''), '^\s*[Cc]ust\w*\s*[:|-]\s*', ''))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Nama tanpa kata generik: yang tersisa adalah nama pembeda + nama tempat.
-- `kab`/`kota` ikut dibuang karena ia satuan wilayah, bukan pembeda faskes.
CREATE OR REPLACE FUNCTION faskes_inti(s text) RETURNS text AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(
           regexp_replace(COALESCE(s,''), '^\s*[Cc]ust\w*\s*[:|-]\s*', '')),
           '\m(rs|rsu|rsud|rsup|rsi|rsab|rsb|rumah|sakit|puskesmas|puskes|pkm|klinik|utama|pratama|lab|laboratorium|labkesda|dinkes|apotek|apotik|pt|cv|kab|kota)\M',
           ' ', 'g'),
         '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Token milik `a` yang TIDAK dimiliki `b`. Inilah yang membuang nama kota:
-- 'muh babat' terhadap 'nu babat' menyisakan 'muh' saja.
CREATE OR REPLACE FUNCTION faskes_sisa(a text, b text) RETURNS text AS $$
  SELECT COALESCE(string_agg(x, ' ' ORDER BY x), '')
    FROM unnest(string_to_array(COALESCE(a,''), ' ')) x
   WHERE x <> '' AND NOT (x = ANY(string_to_array(COALESCE(b,''), ' ')))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Apakah nama laporan `rep` dan nama rencana `pln` menunjuk faskes yang sama?
-- Dipakai sebagai saringan TAMBAHAN sesudah `similarity() > 0.3`, bukan
-- penggantinya — jadi ia hanya mempersempit, tak pernah memperluas kecocokan.
CREATE OR REPLACE FUNCTION faskes_cocok(rep text, pln text) RETURNS boolean AS $$
  SELECT CASE
    -- 1. varian penulisan/salah eja dari nama yang sama
    WHEN similarity(regexp_replace(COALESCE(rep,''), '^\s*[Cc]ust\w*\s*[:|-]\s*', ''),
                    COALESCE(pln,'')) >= 0.5 THEN true
    -- 3. tak ada yang tersisa untuk dinilai → pakai aturan lama
    WHEN faskes_inti(rep) = '' OR faskes_inti(pln) = '' THEN true
    -- 2. singkatan / perluasan
    WHEN position(faskes_inti(rep) in faskes_inti(pln)) > 0
      OR position(faskes_inti(pln) in faskes_inti(rep)) > 0 THEN true
    -- semua token dibagi bersama → tak ada pembeda yang tersisa
    WHEN faskes_sisa(faskes_inti(rep), faskes_inti(pln)) = ''
      OR faskes_sisa(faskes_inti(pln), faskes_inti(rep)) = '' THEN true
    -- inti perkara: nilai HANYA bagian yang membedakan
    ELSE similarity(faskes_sisa(faskes_inti(rep), faskes_inti(pln)),
                    faskes_sisa(faskes_inti(pln), faskes_inti(rep))) > 0.4
  END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION faskes_cocok(text, text) IS
  'Saringan tambahan pencocokan #REPORT->sales_plan: tolak pasangan yang kesamaannya hanya di kata generik + nama tempat. Lihat 176_cocok_faskes.sql.';
