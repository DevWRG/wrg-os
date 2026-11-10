export type PmfStatus = "MENANG" | "NETRAL" | "KALAH" | "DATA KURANG";

export interface PmfSel {
  brand: string;
  region: string;
  produk?: string; // hanya di per_produk
  won: number;
  lost: number;
  n: number;
  win_rate: number | null;
  selisih_poin: number | null;
  status: PmfStatus;
  lost_tanpa_alasan: number;
}

export interface PmfScorecard {
  tahun: number | null; // null = semua tahun
  kuartal: number | null; // null = setahun penuh / semua
  periode: { dari: string | null; sampai: string | null };
  ambang: { min_deal: number; poin: number };
  ringkasan: {
    won: number;
    lost: number;
    n: number;
    win_rate: number | null;
    impor_dikeluarkan: number;
    tanggal_fallback: number;
    tanpa_region: number;
    lost_tanpa_alasan: number;
  };
  per_brand: PmfSel[];
  sel: PmfSel[];
  per_produk: PmfSel[];
}
