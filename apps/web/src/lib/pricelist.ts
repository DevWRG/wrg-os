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

// Konstanta insentif (dari spreadsheet sumber, verified 61/61 baris).
export const POINT_DIVISOR = 500; // Total Point = Nett WRG / 500
export const MIN_INCENTIVE_RATE = 0.05; // Min Incentive Pts = Total Point * 5%
export const MAX_INCENTIVE_RATE = 0.08; // Max Incentive Pts = Total Point * 8%

export interface PricelistDerived {
  priceList: number; // Harga Principal(HPP) / (1 - margin)
  valueDiskon: number; // priceList * diskon
  nettPrice: number; // priceList - valueDiskon
  pricePpn: number; // priceList * (1 + PPN)
  margin: number; // priceList - hpp (margin kotor Rupiah = basis alokasi insentif)
  // Insentif — Value = Margin × % (alokasi dari margin, bukan Price List).
  valueWrg: number; // margin * pctWrg
  valuePromosi: number; // margin * pctPromosi
  valueHodSales: number; // margin * pctHodSales (a.k.a. "Value Lain Lain")
  nettWrg: number; // margin - (valueWrg + valuePromosi + valueHodSales) = sisa margin
  totalPoint: number; // nettWrg / 500
  minIncentivePts: number; // totalPoint * 5%
  maxIncentivePts: number; // totalPoint * 8%
}

export const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function derivePricing(
  hpp: number,
  marginPct: number,
  diskonPct: number,
  pctWrg = 0,
  pctPromosi = 0,
  pctHodSales = 0,
): PricelistDerived {
  const priceList = marginPct >= 1 ? hpp : hpp / (1 - marginPct);
  const valueDiskon = priceList * diskonPct;
  const margin = priceList - hpp; // margin kotor Rupiah = basis alokasi insentif
  const valueWrg = margin * pctWrg;
  const valuePromosi = margin * pctPromosi;
  const valueHodSales = margin * pctHodSales;
  const nettWrg = margin - (valueWrg + valuePromosi + valueHodSales);
  const totalPoint = nettWrg / POINT_DIVISOR;
  return {
    priceList,
    valueDiskon,
    nettPrice: priceList - valueDiskon,
    pricePpn: priceList * (1 + PPN_RATE),
    margin,
    valueWrg,
    valuePromosi,
    valueHodSales,
    nettWrg,
    totalPoint,
    minIncentivePts: totalPoint * MIN_INCENTIVE_RATE,
    maxIncentivePts: totalPoint * MAX_INCENTIVE_RATE,
  };
}

// ── Baris untuk muka AM/sales ──────────────────────────────────────────────
// HANYA angka yang boleh dilihat sales. Sengaja TANPA hpp / margin_pct / alokasi
// insentif: kalau `PricelistRow` utuh diteruskan ke komponen klien, HPP & margin
// ikut ter-serialisasi ke HTML + payload RSC dan bisa dibaca siapa pun yang membuka
// "view source" atau tab Network — walau tak ada satu kolom pun yang menampilkannya.
// Itu persis yang dilarang HANDOVER §1/§9. Karena tabel AM butuh Price List / Nett /
// Nett+PPN yang turunan dari HPP, turunannya DIHITUNG DI SERVER lewat toAmRow().
export interface AmPricelistRow {
  id: string;
  product_no: string | null;
  product_name: string | null;
  priceList: number;
  diskonPct: number;
  nettPrice: number;
  pricePpn: number;
}

export function toAmRow(row: PricelistRow): AmPricelistRow {
  const d = deriveRow(row);
  return {
    id: row.id,
    product_no: row.product_no,
    product_name: row.product_name,
    priceList: d.priceList,
    diskonPct: num(row.diskon_pct),
    nettPrice: d.nettPrice,
    pricePpn: d.pricePpn,
  };
}

export function deriveRow(row: PricelistRow): PricelistDerived {
  return derivePricing(
    num(row.hpp),
    num(row.margin_pct),
    num(row.diskon_pct),
    num(row.pct_wrg),
    num(row.pct_promosi),
    num(row.pct_hod_sales),
  );
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
