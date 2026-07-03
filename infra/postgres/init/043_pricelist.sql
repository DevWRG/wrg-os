-- 043 — Pricelist: harga jual per produk.
-- Basis Price List = Harga Principal (HPP) yang DIINPUT MANUAL oleh HoD Business /
-- Purchasing — BUKAN accurate_item.unit_price (itu harga rata-rata/average).
-- accurate_item dipakai hanya untuk identitas produk (no/nama/kategori) + harga
-- average sebagai referensi. Harga turunan (Price List, Value Diskon, Nett Price,
-- Price+PPN) DIHITUNG di aplikasi dari input di bawah (lihat apps/web/src/lib/pricelist.ts).
-- Alur: HoD Business/Purchasing isi (status 'draft') → publish → AM lihat ('published').

CREATE TABLE IF NOT EXISTS pricelist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    bigint NOT NULL REFERENCES accurate_item(id),

  -- input harga (Harga Principal = HPP → basis Price List)
  hpp           numeric(16,2) NOT NULL DEFAULT 0,
  margin_pct    numeric(6,4)  NOT NULL DEFAULT 0,  -- fraksi: 0.35 = 35%
  diskon_pct    numeric(6,4)  NOT NULL DEFAULT 0,  -- fraksi

  -- alokasi insentif (fraksi)
  pct_wrg       numeric(6,4)  NOT NULL DEFAULT 0,
  pct_promosi   numeric(6,4)  NOT NULL DEFAULT 0,
  pct_hod_sales numeric(6,4)  NOT NULL DEFAULT 0,

  -- loyalty / poin
  total_point        integer NOT NULL DEFAULT 0,
  min_incentive_pts  integer NOT NULL DEFAULT 0,
  max_incentive_pts  integer NOT NULL DEFAULT 0,
  min_redemption     integer NOT NULL DEFAULT 0,
  cutoff_days        integer NOT NULL DEFAULT 0,

  -- konfirmasi area (gerbang publish)
  west_area_confirmation boolean NOT NULL DEFAULT false,
  east_area_confirmation boolean NOT NULL DEFAULT false,

  -- status publikasi
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at  timestamptz,
  published_by  text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS pricelist_status_idx ON pricelist (status);
