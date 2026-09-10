-- 177_cocok_faskes_transposisi.sql — salah ketik transposisi bukan faskes beda
--
-- LATAR
-- Migrasi 176 menilai kecocokan dari SISA nama setelah kata generik dan bagian
-- bersama dibuang. Itu benar untuk membedakan faskes, tapi trigram menghukum
-- transposisi huruf terlalu keras:
--
--     'RSD Haryoto' vs 'RSD Hartoyo'   similarity utuh = 0,41  (< 0,50)
--                     sisa 'haryoto' vs 'hartoyo' = 0,23  (< 0,40)  -> DITOLAK
--
-- Padahal itu RS yang SAMA — RSUD dr. Haryoto Lumajang; 'Hartoyo' salah ketik.
-- Ketahuan saat menelusuri 29 tautan yang ditolak 176: 28 memang faskes
-- berbeda, satu ini tidak.
--
-- ATURAN TAMBAHAN
-- Kalau sisa kedua nama punya HIMPUNAN HURUF yang identik, itu penulisan ulang
-- dari nama yang sama:  haryoto -> a,h,o,o,r,t,y  =  hartoyo -> a,h,o,o,r,t,y
--
-- Sengaja dipilih ketimbang levenshtein(): fuzzystrmatch tak terpasang di dev
-- maupun prod, dan menambah extension demi satu baris tak sepadan. Aturan huruf
-- juga LEBIH KETAT — ia hanya menerima penataan ulang huruf yang sama persis,
-- jadi tak mungkin menerima nama yang hurufnya memang berbeda.
--
-- DIUKUR pada 3.418 tautan di produksi: tolakan 29 -> 28, dan satu-satunya yang
-- berubah jadi diterima adalah 'RSD Haryoto' <-> 'RSD Hartoyo'. Tak ada yang
-- lain ikut terbawa.

-- Huruf & angka sebuah nama, diurutkan. Pembanding transposisi.
CREATE OR REPLACE FUNCTION faskes_huruf(s text) RETURNS text AS $$
  SELECT COALESCE(string_agg(c, '' ORDER BY c), '')
    FROM unnest(string_to_array(regexp_replace(lower(COALESCE(s,'')), '[^a-z0-9]', '', 'g'), NULL)) c
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION faskes_cocok(rep text, pln text) RETURNS boolean AS $$
  SELECT CASE
    -- 1. varian penulisan/salah eja dari nama yang sama
    WHEN similarity(regexp_replace(COALESCE(rep,''), '^\s*[Cc]ust\w*\s*[:|-]\s*', ''),
                    COALESCE(pln,'')) >= 0.5 THEN true
    -- 2. tak ada yang tersisa untuk dinilai -> pakai aturan lama
    WHEN faskes_inti(rep) = '' OR faskes_inti(pln) = '' THEN true
    -- 3. singkatan / perluasan
    WHEN position(faskes_inti(rep) in faskes_inti(pln)) > 0
      OR position(faskes_inti(pln) in faskes_inti(rep)) > 0 THEN true
    -- 4. semua token dibagi bersama -> tak ada pembeda yang tersisa
    WHEN faskes_sisa(faskes_inti(rep), faskes_inti(pln)) = ''
      OR faskes_sisa(faskes_inti(pln), faskes_inti(rep)) = '' THEN true
    -- 5. sisa berhuruf identik -> salah ketik transposisi (Haryoto/Hartoyo)
    WHEN faskes_huruf(faskes_sisa(faskes_inti(rep), faskes_inti(pln)))
       = faskes_huruf(faskes_sisa(faskes_inti(pln), faskes_inti(rep))) THEN true
    -- 6. inti perkara: nilai HANYA bagian yang membedakan
    ELSE similarity(faskes_sisa(faskes_inti(rep), faskes_inti(pln)),
                    faskes_sisa(faskes_inti(pln), faskes_inti(rep))) > 0.4
  END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
