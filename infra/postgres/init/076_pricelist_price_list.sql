-- 076 — `pricelist.price_list`: Price List yang SUDAH dibulatkan di sumber.
--
-- Tabel `pricelist` (043) memodelkan harga sebagai turunan: margin adalah input,
-- Price List = HPP / (1 - margin). Itu benar selama angkanya lahir di aplikasi.
--
-- Tapi sumber sebenarnya (Google Sheet "3. PL Product Compilation", sheet
-- `Business IVD`) menyimpan Price List sebagai angka yang sudah DIBULATKAN
-- manual ke angka jual yang enak: HPP 28.875.000 · margin 28,7% menghasilkan
-- 40.497.896, sedangkan yang dipakai jualan 40.500.000. Pada export 30 Juli 2026
-- itu kena 37 dari 398 baris yang diperiksa.
--
-- Kalau aplikasi menghitung ulang, angka di layar beda dari price list resmi —
-- persis kesalahan yang dihindari di price book (071/073: "harga tidak boleh
-- dihitung ulang dengan pembulatan sendiri"). Jadi Price List sumber disimpan
-- apa adanya di sini dan MENANG atas hasil hitungan:
--
--   priceList = COALESCE(price_list, hpp / (1 - margin_pct))
--
-- NULL = tidak ada angka dari sumber → hitung dari margin seperti semula, jadi
-- baris yang diinput manual lewat form tetap bekerja seperti sebelumnya.
-- Turunan lain (Value Diskon, Nett, Price+PPN, margin Rupiah, alokasi insentif)
-- ikut memakai priceList hasil COALESCE itu — lihat apps/web/src/lib/pricelist.ts.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE pricelist
  ADD COLUMN IF NOT EXISTS price_list numeric(16,2);

-- Harga tak pernah nol/negatif; NULL saja yang berarti "tidak ada dari sumber".
ALTER TABLE pricelist
  DROP CONSTRAINT IF EXISTS pricelist_price_list_ck;
ALTER TABLE pricelist
  ADD CONSTRAINT pricelist_price_list_ck CHECK (price_list IS NULL OR price_list > 0);

COMMENT ON COLUMN pricelist.price_list IS
  'Price List apa adanya dari sumber (sudah dibulatkan manual). Menang atas hpp/(1-margin_pct); NULL = hitung dari margin.';
