// Tipe + perhitungan harga turunan pricelist (sisi web). Sumber kebenaran input
// ada di DB (tabel pricelist); harga turunan dihitung di sini agar konsisten.

export const PPN_RATE = 0.11; // PPN 11% atas Price List (gross), bukan Nett.

// Bentuk baris dari apps/api GET /pricelist (numeric dikirim sebagai string).
export interface PricelistRow {
  id: string;
  product_id: string;
  product_no: string | null;
  product_name: string | null;
  product_category: string | null;
  product_avg_price: string | null;
  hpp: string;
  margin_pct: string;
  diskon_pct: string;
  pct_wrg: string;
  pct_promosi: string;
  pct_hod_sales: string;
  total_point: number;
  min_incentive_pts: number;
  max_incentive_pts: number;
  min_redemption: number;
  cutoff_days: number;
  west_area_confirmation: boolean;
  east_area_confirmation: boolean;
  status: string;
  published_at: string | null;
  published_by: string | null;
  updated_at: string;
}

export interface PricelistDerived {
  priceList: number; // Harga Principal(HPP) / (1 - margin)
  valueDiskon: number; // priceList * diskon
  nettPrice: number; // priceList - valueDiskon
  pricePpn: number; // priceList * (1 + PPN)
}

export const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function derivePricing(hpp: number, marginPct: number, diskonPct: number): PricelistDerived {
  const priceList = marginPct >= 1 ? hpp : hpp / (1 - marginPct);
  const valueDiskon = priceList * diskonPct;
  return {
    priceList,
    valueDiskon,
    nettPrice: priceList - valueDiskon,
    pricePpn: priceList * (1 + PPN_RATE),
  };
}

export function deriveRow(row: PricelistRow): PricelistDerived {
  return derivePricing(num(row.hpp), num(row.margin_pct), num(row.diskon_pct));
}

const rupiahFmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export const formatRupiah = (v: number): string => rupiahFmt.format(v);

// Fraksi (0.35) → "35%".
export const formatPercent = (fraction: number): string =>
  `${(fraction * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
