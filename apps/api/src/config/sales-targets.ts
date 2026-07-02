// Target penjualan (Rupiah) per periode & region untuk kartu Sales Performance.
//
// `null` = belum diisi → UI menampilkan "No data" (spt kartu "Sales Today" di
// dashboard referensi). Isi angka dari manajemen. Total per periode dihitung
// otomatis = east + west (OFFICE tidak ditargetkan — kartu hanya menampilkan
// % East Target & % West Target).
//
// Contoh dari dashboard referensi: target YTD (tahunan) total 125.000.000.000,
// artinya east + west = 125 M. Bagi sesuai porsi masing-masing region.

export type PeriodKey = "year" | "quarter" | "month";

export interface RegionTarget {
  east: number | null;
  west: number | null;
}

export const SALES_TARGETS: Record<PeriodKey, RegionTarget> = {
  year: { east: null, west: null }, // target tahunan (YTD)
  quarter: { east: null, west: null }, // target kuartalan
  month: { east: null, west: null }, // target bulanan
};
