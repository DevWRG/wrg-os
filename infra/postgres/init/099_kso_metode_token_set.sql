-- 099 — Izinkan metode pencocokan 'token_set' di kso_customer_map (098).
--
-- KENAPA: cabang 'tanpa_kota' di 098 tidak pernah kena pada data nyata — 0 dari 250 nama.
-- Asumsinya sheet menempelkan kota ke belakang nama Accurate sehingga ekornya tinggal
-- dipotong. Kenyataannya nama Accurate SENDIRI yang memuat kota (2.896 dari 2.932
-- mengandung KOTA/KAB.); yang berbeda urutan katanya:
--     sheet    'RS Widodo Ngawi'
--     Accurate 'WIDODO, RS KAB. NGAWI'
-- Memotong kota dari sisi sheet justru menjamin meleset.
--
-- 'token_set' menggantikannya: dua nama dianggap sama bila HIMPUNAN token bermaknanya
-- identik setelah kata jenis faskes & administratif (RS/RSU/RSUD/RSIA/KLINIK/LAB/KAB/
-- KOTA/PT/...) dibuang. Urutan kata diabaikan. Tetap DETERMINISTIK — tidak ada skor,
-- tidak ada ambang, tidak ada tebakan. Dua pagar supaya tetap aman:
--   • minimal 2 token bermakna  -> 'MALANG' tidak boleh cocok ke 'RSUD KOTA MALANG'
--   • himpunan harus unik       -> kalau dua customer Accurate menghasilkan himpunan yang
--                                  sama, keduanya ditolak dan jatuh ke fuzzy (usulan)
--
-- Hasil terukur atas data nyata: deterministik naik dari 62 (26,4%) ke 111 (47,2%) dari
-- 235 nama, tanpa satu pun usulan fuzzy diterima otomatis.
--
-- 'tanpa_kota' SENGAJA TIDAK DIHAPUS dari daftar nilai yang sah: baris lama yang terlanjur
-- memakainya (kalau 098 sudah pernah dijalankan di suatu lingkungan) tetap valid, dan
-- menghapusnya akan membuat migrasi ini gagal di tengah.

ALTER TABLE kso_customer_map DROP CONSTRAINT IF EXISTS kso_customer_map_metode_check;

ALTER TABLE kso_customer_map ADD CONSTRAINT kso_customer_map_metode_check
  CHECK (metode IN ('belum','exact','token_set','tanpa_kota','fuzzy','manual','tidak_ada'));

COMMENT ON COLUMN kso_customer_map.metode IS
  'exact/token_set = deterministik, dipasang otomatis. fuzzy = USULAN, jangan dipercaya sebelum dikonfirmasi. tanpa_kota = warisan, tidak dihasilkan lagi. tidak_ada = sudah dicek, memang bukan customer Accurate.';
