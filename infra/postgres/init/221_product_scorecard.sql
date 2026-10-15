-- 221 — F6 Product Performance Scorecard: peta lini produk → kategori kompetitor.
--
-- Deteksi kompetitor F131 (competitor_intel.produk_kategori) memakai kategori KASAR
-- (POCT, Kimia Klinik, Hematologi, Imunologi, BGA, Alkes, BMHP, Reagen), sedangkan
-- Klasifikasi Produk punya 58 lini. Peta ini menyambungkan keduanya supaya scorecard per
-- lini bisa menampilkan tekanan kompetitor di faskes. DATA, bukan kode: HoD bisa
-- mengubah/menambah baris tanpa deploy. Lini yang tak dipetakan = kolom kompetitor kosong.
--
-- Kunci lini = (kategori_id, line_id) — id lini TIDAK unik sendirian (line '11' =
-- 'POCT Cholestrol' di IVD tapi 'General Equipment' di NON IVD).
--
-- Nomor 221: 219 terbakar (F27 dibuang, ledger dev mencatatnya), 220 = F169 fase 2.

CREATE TABLE IF NOT EXISTS product_line_kompetitor (
  kategori_id          text NOT NULL,
  line_id              text NOT NULL,
  kategori_kompetitor  text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kategori_id, line_id)
);

COMMENT ON TABLE product_line_kompetitor IS
  'F6: lini Klasifikasi Produk (kategori_id, line_id) -> kategori kasar competitor_intel.produk_kategori (bagian sebelum "|"). Isi awal dari nama lini (migrasi 221); boleh diubah.';

-- Isi awal dari nama lini (hanya bila tabel kosong, supaya editan tak tertimpa).
INSERT INTO product_line_kompetitor (kategori_id, line_id, kategori_kompetitor)
SELECT l.kategori_id, l.id,
       CASE
         WHEN l.kategori_id = '01' AND l.nama ILIKE 'POCT%'                       THEN 'POCT'
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Hematology%', 'ESR%', 'Coagulation%']) THEN 'Hematologi'
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Clinical Chemistry%', 'Urinalisa%']) THEN 'Kimia Klinik'
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Imunology%', 'Immunology%', 'Serology%']) THEN 'Imunologi'
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Blood Gas%', 'Electrolyte%']) THEN 'BGA'
         WHEN l.kategori_id = '01' AND l.nama ILIKE 'Reagen%'                     THEN 'Reagen'
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Pre Analitik%', 'Post Analitik%']) THEN 'BMHP'
         WHEN l.kategori_id = '02' AND l.nama ILIKE ANY (ARRAY['General Equipment%', 'Instruments%', 'Medical Furniture%', 'Medical Kit%', 'ECG%', 'Spirometer%', 'Oxygen%', 'Hemodialysa%']) THEN 'Alkes'
         WHEN l.kategori_id = '02'                                                THEN 'BMHP'
       END
FROM product_line l
WHERE NOT EXISTS (SELECT 1 FROM product_line_kompetitor)
  AND CASE
         WHEN l.kategori_id = '01' AND l.nama ILIKE 'POCT%' THEN true
         WHEN l.kategori_id = '01' AND l.nama ILIKE ANY (ARRAY['Hematology%', 'ESR%', 'Coagulation%', 'Clinical Chemistry%', 'Urinalisa%', 'Imunology%', 'Immunology%', 'Serology%', 'Blood Gas%', 'Electrolyte%', 'Reagen%', 'Pre Analitik%', 'Post Analitik%']) THEN true
         WHEN l.kategori_id = '02' THEN true
         ELSE false
       END
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON product_line_kompetitor TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON product_line_kompetitor TO wrg_readonly;
  END IF;
END $$;
