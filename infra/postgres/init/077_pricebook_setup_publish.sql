-- 077 — Setup Harga keagenan: override harga + gerbang publish di lapisan 073.
--
-- Menu Setup Harga difokuskan ke produk KEAGENAN (keputusan user 1 Agt 2026);
-- tab "Produk Accurate" (tabel `pricelist` 043) dilepas dari alur ini. Supaya
-- HoD Business bisa benar-benar menyetel harga di sana, lapisan kerja
-- `product_pricelist_setup` (073) dapat dua hal:
--
--   1. OVERRIDE harga — `price_list_override` & `diskon_override`.
--      Snapshot handover Direktur (`product_pricelist`, 071) TIDAK pernah ditulis
--      dari aplikasi; itu bukti apa yang diserahkan Direktur. Perubahan harga
--      hidup sebagai override di atasnya, jadi selalu bisa dibandingkan dengan
--      angka aslinya dan re-import price book tidak menabraknya.
--
--      Nilai efektif (dihitung di apps/api/src/repo/pricebook.ts):
--        price  = COALESCE(price_list_override, p.price_list)
--        diskon = COALESCE(diskon_override,     p.diskon_maks)
--        nett   = kalau ADA override → ROUND(price × (1 - diskon))
--                 kalau TIDAK        → p.harga_nett apa adanya
--        ppn    = kalau ADA override → ROUND(nett × 1,11)
--                 kalau TIDAK        → p.nett_ppn apa adanya
--
--      Kenapa "kalau tidak, apa adanya": HANDOVER §9 melarang menghitung ulang
--      angka handover dengan pembulatan sendiri (13 baris beda Rp 1 karena
--      sumbernya half-even, ROUND() spreadsheet half-up). Begitu HoD menyetel
--      harga baru, angka itu bukan lagi angka handover — di situ barulah rumus
--      resmi (nett dari price list, PPN dari NETT) yang berlaku.
--
--   2. GERBANG PUBLISH — `status` / `published_at` / `published_by`.
--      Draft = hanya kelihatan di Setup Harga. Published = ikut tampil di tab
--      "Harga per Produk" pada menu Price Book yang dibuka AM. Sama pola dengan
--      `pricelist` (043) supaya tidak ada dua gaya publikasi di satu produk.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE product_pricelist_setup
  ADD COLUMN IF NOT EXISTS price_list_override numeric(16,2),
  ADD COLUMN IF NOT EXISTS diskon_override     numeric(6,4),
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS published_at        timestamptz,
  ADD COLUMN IF NOT EXISTS published_by        text,
  ADD COLUMN IF NOT EXISTS updated_by          text,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

ALTER TABLE product_pricelist_setup
  DROP CONSTRAINT IF EXISTS product_pricelist_setup_status_ck;
ALTER TABLE product_pricelist_setup
  ADD CONSTRAINT product_pricelist_setup_status_ck
  CHECK (status IN ('draft', 'published'));

-- Harga tak pernah nol/negatif; NULL = tidak ada override, pakai snapshot.
ALTER TABLE product_pricelist_setup
  DROP CONSTRAINT IF EXISTS product_pricelist_setup_pl_override_ck;
ALTER TABLE product_pricelist_setup
  ADD CONSTRAINT product_pricelist_setup_pl_override_ck
  CHECK (price_list_override IS NULL OR price_list_override > 0);

-- Diskon 100% berarti gratis — hampir pasti salah ketik, dan bikin Nett 0.
ALTER TABLE product_pricelist_setup
  DROP CONSTRAINT IF EXISTS product_pricelist_setup_diskon_override_ck;
ALTER TABLE product_pricelist_setup
  ADD CONSTRAINT product_pricelist_setup_diskon_override_ck
  CHECK (diskon_override IS NULL OR (diskon_override >= 0 AND diskon_override < 1));

CREATE INDEX IF NOT EXISTS product_pricelist_setup_status_idx
  ON product_pricelist_setup (periode, status);

COMMENT ON COLUMN product_pricelist_setup.price_list_override IS
  'Price List setelan HoD Business. NULL = pakai product_pricelist.price_list (snapshot handover Direktur, tak pernah ditulis aplikasi).';
COMMENT ON COLUMN product_pricelist_setup.diskon_override IS
  'Diskon maks setelan HoD Business. NULL = pakai product_pricelist.diskon_maks.';
COMMENT ON COLUMN product_pricelist_setup.status IS
  'draft = hanya di Setup Harga · published = ikut tampil ke AM di tab Harga per Produk.';
