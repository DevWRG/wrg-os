-- Proyek HD: nama alat ditautkan ke database produk WRG-OS (klasifikasi produk, migrasi 072),
-- dibatasi ke mesin hemodialisa — product line "Hemodialysa", class "Machine"
-- (kode 02.13.25.*). Keputusan user 16 Nov 2026. nama_alat tetap disimpan sebagai
-- teks tampilan; isinya diambil server dari product_code.nama.

ALTER TABLE hd_proyek ADD COLUMN IF NOT EXISTS produk_kode TEXT REFERENCES product_code(kode);
CREATE INDEX IF NOT EXISTS hd_proyek_produk_idx ON hd_proyek (produk_kode) WHERE produk_kode IS NOT NULL;

-- Proyek lama (dibuat/diimpor dengan nama alat teks): tautkan bila namanya sama persis
-- dengan TEPAT SATU mesin HD di klasifikasi produk.
UPDATE hd_proyek p
   SET produk_kode = m.kode
  FROM (SELECT lower(nama) AS kunci, min(kode) AS kode FROM product_code
         WHERE kode LIKE '02.13.25.%' GROUP BY lower(nama) HAVING count(*) = 1) m
 WHERE p.produk_kode IS NULL AND lower(btrim(p.nama_alat)) = m.kunci;
