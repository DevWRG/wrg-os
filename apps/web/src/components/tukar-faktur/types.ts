// Cermin apps/api/src/repo/tukar-faktur.ts.
export type TahapFaktur = "terbit" | "dicetak" | "lunas";

export interface TukarFakturItem {
  id: string;
  nomor: string;
  customer_id: string | null;
  customer: string;
  tanggal: string | null;
  jatuh_tempo: string | null;
  tgl_bayar: string | null;
  total: number;
  outstanding: number;
  kategori: string[];
  tahap: TahapFaktur;
  overdue: boolean;
  sejak: string | null;
  umur_hari: number | null;
  tua: boolean;
}

export interface TukarFakturHasil {
  generated_at: string;
  hari: number;
  total: number;
  per_tahap: Record<TahapFaktur, number>;
  tua: number;
  terpotong: boolean;
  items: TukarFakturItem[];
}

export type JenisKejadian = "jatuh_tempo" | "bayar";

export interface KejadianKlinik {
  tanggal: string;
  jenis: JenisKejadian;
  customer_id: string;
  customer: string;
  nomor: string;
  nominal: number;
  pic_nama: string | null;
  pic_hp: string | null;
}

export interface KalenderKlinikHasil {
  generated_at: string;
  bulan: string;
  total: number;
  terpotong: boolean;
  events: KejadianKlinik[];
}
