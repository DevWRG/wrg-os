-- 073 — Pricelist Setup untuk price book: HPP + margin + klasifikasi per SKU.
--
-- Sumber: `Master_Kroscek_PriceList_H2_2026.xlsx` sheet `Sheet2` — hasil kroscek
-- manual antara file handover Direktur (PL H2-2026) dan Google Sheet
-- "3. PL Product Compilation". Satu baris Sheet2 = satu baris price book:
-- kolom `Baris PL Direktur` MINUS 1 = `product_pricelist.row_no` (baris 2 di
-- sheet = record pertama di CSV). Verified 1031/1031 nyambung, dan kolom harga
-- (HARGA FINAL / DISKON FINAL / Nett / Nett+PPN / kode) IDENTIK dengan yang
-- sudah ada di `product_pricelist` — Sheet2 tidak mengubah harga, dia menambah
-- HPP, margin, nama final, dan klasifikasi.
--
-- KENAPA TABEL TERPISAH, bukan kolom baru di `product_pricelist`:
--   1. HPP & margin itu angka INTERNAL (Purchasing / HoD Business). Tabel
--      `product_pricelist` dibaca menu /pricebook yang dipakai sales & AM di
--      lapangan; menaruh HPP di baris yang sama bikin satu `SELECT *` yang
--      lupa memilih kolom = kebocoran margin ke sales. Di sini gate-nya
--      struktural: endpoint AM tidak menyentuh tabel ini sama sekali.
--   2. `product_pricelist` sengaja dibentuk sebagai SNAPSHOT apa adanya dari
--      handover Direktur (lihat 071). Hasil kroscek = lapisan kerja di atasnya,
--      bisa di-import ulang tanpa menyentuh snapshot-nya.
--   3. Penulis 071 sudah menuliskan niat ini: "kalau nanti file HPP/sub-dealer
--      datang, itu tabel terpisah".
--
-- Harga turunan (Price List, Value Diskon, Nett, Price+PPN, alokasi insentif,
-- poin) TIDAK disimpan — dihitung di aplikasi lewat apps/web/src/lib/pricelist.ts
-- persis seperti tabel `pricelist` (043), supaya cuma ada satu rumus yang hidup.
--
-- Data TIDAK ikut di repo — repo ini PUBLIC, HPP & margin bukan data publik.
-- Isi lewat importer: scripts/db/import_kroscek_pricelist.py.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS product_pricelist_setup (
  -- Kunci = baris price book. ON DELETE CASCADE: kalau snapshot periode itu
  -- dibuang, lapisan kroscek-nya ikut, tidak ada yatim.
  periode  text NOT NULL,
  row_no   int  NOT NULL,

  -- Nama hasil kroscek ("NAMA FINAL (sesuaikan di sini)"). 326 dari 1031 baris
  -- beda dari nama di handover — nama handover TETAP disimpan di
  -- product_pricelist.nama, jadi keduanya bisa dibandingkan kapan saja.
  nama_final text,
  varian     text,          -- "Varian / Ukuran"
  kemasan    text,          -- "Kemasan (Compilation)", jatuh ke Direktur kalau kosong
  satuan     text,

  -- ── Angka internal (JANGAN diekspos ke endpoint AM/sales) ────────────────
  -- hpp NULL = SKU belum ada HPP-nya di Compilation (89 baris, mayoritas EDAN).
  -- Barisnya tetap ada supaya kelihatan "belum lengkap", bukan hilang.
  hpp        numeric(16,2),
  -- CATATAN: margin SENGAJA tidak disimpan. Arah rumusnya di sini kebalikan dari
  -- tabel `pricelist` (043): di 043 margin adalah INPUT dan harga dihitung
  -- (harga = hpp/(1-margin)); di price book HARGA-nya yang final dari Direktur
  -- dan margin cuma turunan → margin = 1 - hpp/price_list, dihitung saat query.
  -- Kalau disimpan sebagai numeric(6,4) malah rusak: margin 0,250938…
  -- terpotong jadi 0,2509 dan hpp/(1-0,2509) = 133.494 ≠ 133.500 (harga asli).
  -- Kolom "Margin Baru" di Sheet2 tetap DIPERIKSA importer (harus sama dengan
  -- turunan ini), hanya tidak ikut disimpan supaya tak ada angka kembar.

  -- ── Klasifikasi 4 level (072) ────────────────────────────────────────────
  -- Di-resolve HIRARKIS oleh importer: Lini → kategori (IVD→01, Alkes→02
  -- NON IVD), lalu Product Line / Class dicari di dalam kategorinya, Sub Class
  -- di dalam (kategori, class)-nya. Nama kembar lintas kategori karena itu
  -- tidak bisa nyasar. Baris yang tak ter-resolve → product_code_review.
  --
  -- Nullable + FK MATCH SIMPLE: kalau salah satu kolom NULL, FK tidak diuji.
  -- Itu memang yang diinginkan — 938 baris dapat Class tapi hanya 861 yang
  -- Sub Class-nya terdaftar, dan Class yang sudah benar tidak ikut dibuang
  -- gara-gara Sub Class-nya belum ada di master.
  kategori_id  text,
  line_id      text,
  class_id     text,
  sub_class_id text,

  -- Kode produk KK.PP.CC.SSS.NNNN yang sudah terbit di product_code, kalau
  -- barisnya bisa dipasangkan. Lewat kode saja (kode_legacy / kode), BUKAN
  -- fuzzy nama — nama produk tidak unik.
  product_kode text REFERENCES product_code (kode) ON UPDATE CASCADE ON DELETE SET NULL,
  -- Kolom "Kode Accurate" APA ADANYA dari Sheet2. Namanya di sheet menyesatkan:
  -- isinya kode internal 5-bagian (hasil generator sheet), BUKAN nomor item
  -- Accurate (IDS.0276 / AKS.0828). Disimpan mentah untuk jejak audit.
  kode_sumber  text,

  kroscek_no  int,          -- kolom "No" di Sheet2 (nomor baris file kroscek)
  catatan     text,
  imported_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (periode, row_no),
  FOREIGN KEY (periode, row_no)
    REFERENCES product_pricelist (periode, row_no) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (kategori_id, line_id)
    REFERENCES product_line (kategori_id, id) ON UPDATE CASCADE,
  FOREIGN KEY (kategori_id, class_id)
    REFERENCES product_class (kategori_id, id) ON UPDATE CASCADE,
  FOREIGN KEY (kategori_id, class_id, sub_class_id)
    REFERENCES product_sub_class (kategori_id, class_id, id) ON UPDATE CASCADE,

  CONSTRAINT product_pricelist_setup_hpp_ck CHECK (hpp IS NULL OR hpp > 0)
);

CREATE INDEX IF NOT EXISTS product_pricelist_setup_kode_idx
  ON product_pricelist_setup (product_kode) WHERE product_kode IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_pricelist_setup_klas_idx
  ON product_pricelist_setup (kategori_id, line_id, class_id, sub_class_id);
CREATE INDEX IF NOT EXISTS product_pricelist_setup_hpp_idx
  ON product_pricelist_setup (periode) WHERE hpp IS NULL;

COMMENT ON TABLE product_pricelist_setup IS
  'Lapisan kerja Pricelist Setup di atas snapshot price book (071): HPP, margin & klasifikasi per SKU dari kroscek Sheet2. INTERNAL — jangan diekspos ke endpoint AM/sales.';
COMMENT ON COLUMN product_pricelist_setup.hpp IS
  'Harga Principal. INTERNAL. NULL = belum ada HPP di sumber Compilation.';
COMMENT ON COLUMN product_pricelist_setup.kode_sumber IS
  'Kolom "Kode Accurate" mentah dari Sheet2 — sebenarnya kode internal 5-bagian, bukan nomor item Accurate.';
