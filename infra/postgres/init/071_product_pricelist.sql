-- 071 — F142 Price Book: katalog harga jual resmi WRG (produk KEAGENAN).
--
-- Bedanya dengan tabel `pricelist` (043): 043 itu kalkulator harga per produk
-- Accurate (HPP → margin → poin insentif, internal Purchasing/HoD Business).
-- Tabel ini adalah SNAPSHOT price book yang sudah difinalkan Direktur dan
-- dipakai sales di lapangan — 4 kolom harga per SKU, tanpa HPP/margin.
--
-- Sumber: handover Direktur 2026-07-27, folder Drive `16-Sales-PriceList-H2-2026`
-- (WRG_Sales_PriceList_H2_2026.csv, 1.031 SKU · 89 brand · 694 IVD + 337 Medical).
--
-- Data TIDAK ikut di repo — repo ini PUBLIC, price book bukan data publik.
-- Isi tabel lewat importer: scripts/db/import_pricebook.py (baca CSV dari Drive).
--
-- Aturan harga yang TIDAK boleh dihitung ulang dengan pembulatan sendiri
-- (HANDOVER §3 & §9):
--   harga_nett = ROUND(price_list * (1 - diskon_maks), 0)   ← LANTAI harga sales
--   nett_ppn   = ROUND(harga_nett * 1.11, 0)                ← PPN dari NETT, bukan
--                dari price list (UU PPN Ps 1 ang 18; tarif efektif 11% per
--                PMK 131/2024 DPP nilai lain 11/12 × 12%). Diskon WAJIB muncul
--                di faktur pajak, kalau tidak DPP tak berkurang sah.
-- Karena itu kedua kolom disimpan apa adanya dari sumber, bukan generated column.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS product_pricelist (
  id          bigserial PRIMARY KEY,
  -- Periode berlaku. 'H2-2026' = Jul–Des 2026 (HANDOVER §8 poin 7: masa berlaku
  -- masih ASUMSI dari nama file, belum ada dokumen kebijakan). Periode baru =
  -- baris baru, snapshot lama tetap bisa dibuka.
  periode     text    NOT NULL DEFAULT 'H2-2026',
  -- Nomor baris di CSV sumber = kunci alami. Nama produk TIDAK unik (22 nama
  -- duplikat = 111 baris, pembedanya cuma varian/Sub Class), dan 141 SKU tidak
  -- punya kode Accurate — jadi tak ada kombinasi kolom bisnis yang bisa jadi
  -- kunci. row_no bikin re-import idempoten.
  row_no      int     NOT NULL,

  kode        text,                       -- kode Accurate; NULL untuk 141 SKU (HANDOVER §8 poin 2)
  lini        text    NOT NULL CHECK (lini IN ('IVD','Medical')),
  brand       text    NOT NULL,
  nama        text    NOT NULL,
  varian      text,                       -- Sub Class — pembeda SKU bernama sama
  kemasan     text,
  kategori    text,
  -- FALSE = kategori hasil pemetaan kata kunci, tidak ada di master taxonomy WRG
  -- (141 SKU, mayoritas EDAN 86 + ONEJECT 20). Harga tetap valid, labelnya yang
  -- belum pasti. TRUE pun artinya cuma "sesuai master", bukan "diperiksa manusia"
  -- (HANDOVER §8 poin 3: ada stetoskop berkategori Machine di master).
  kategori_verified boolean NOT NULL DEFAULT false,

  price_list  numeric(16,2) NOT NULL,     -- harga resmi WRG (angka pembuka sales)
  diskon_maks numeric(6,4)  NOT NULL,     -- fraksi; hanya 3 nilai: 0.05 / 0.10 / 0.20
  harga_nett  numeric(16,2) NOT NULL,     -- LANTAI; di bawah ini butuh izin Direksi
  nett_ppn    numeric(16,2) NOT NULL,     -- yang muncul di faktur ke faskes
  rentang_harga text,                     -- band A–E dari sumber (bucket harga)
  catatan     text,                       -- koreksi kebijakan per baris (HANDOVER §5)

  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (periode, row_no)
);

CREATE INDEX IF NOT EXISTS product_pricelist_periode_idx ON product_pricelist (periode);
CREATE INDEX IF NOT EXISTS product_pricelist_kode_idx    ON product_pricelist (kode) WHERE kode IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_pricelist_brand_idx   ON product_pricelist (periode, brand);
CREATE INDEX IF NOT EXISTS product_pricelist_lini_idx    ON product_pricelist (periode, lini);

COMMENT ON TABLE product_pricelist IS
  'F142 Price Book — katalog harga jual produk KEAGENAN WRG per periode (snapshot handover Direktur). Item Accurate yang tak punya pasangan di sini = di luar keagenan.';
