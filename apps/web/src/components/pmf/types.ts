export type PmfStatus = "MENANG" | "NETRAL" | "KALAH" | "DATA KURANG";

export interface PmfSel {
  brand: string;
  region: string;
  won: number;
  lost: number;
  n: number;
  win_rate: number | null;
  selisih_poin: number | null;
  status: PmfStatus;
  lost_tanpa_alasan: number;
}

export interface PmfScorecard {
  tahun: number;
  kuartal: number;
  periode: { dari: string; sampai: string };
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
}
