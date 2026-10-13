// F74 Kampanye — tipe bersama (cermin apps/api/src/repo/campaign.ts).

export type StatusKampanye = "akan datang" | "berjalan" | "selesai" | "dibatalkan";

export interface Pacing {
  hari_ke: number;
  hari_total: number;
  harapan_pct: number;
  capai_pct: number | null;
  status: "di depan" | "sesuai" | "tertinggal" | null;
}

export interface ItemKampanye { item_id: string; no: string | null; nama: string | null; brand: string | null }

export interface Kampanye {
  id: string;
  kode: string;
  nama: string;
  deskripsi: string | null;
  tanggal_mulai: string;
  tanggal_selesai: string;
  satuan_qty: string | null;
  dibatalkan: boolean;
  status: StatusKampanye;
  brands: string[];
  items: ItemKampanye[];
  created_by: string | null;
  updated_at: string;
}

export interface KampanyeList extends Kampanye {
  ringkasan: { target_rp: number; target_qty: number | null; netto: number; qty: number; faktur: number; customer: number; pacing: Pacing };
}

export interface BarisAm {
  am_id: string;
  nama: string;
  cabang: string | null;
  target_rp: number;
  target_qty: number | null;
  netto: number;
  qty: number;
  faktur: number;
  customer: number;
  so_netto: number;
  tahun_lalu: number;
  pacing: Pacing;
}

export interface DetailKampanye {
  kampanye: Kampanye;
  ringkasan: {
    target_rp: number; target_qty: number | null; netto: number; qty: number; faktur: number; customer: number;
    so_netto: number; so: number; tahun_lalu: number | null; pacing: Pacing;
  };
  corong: {
    lead: number; lead_dikonversi: number; deal: number; deal_menang: number; pipeline_terbuka: number;
    aktivitas: number; demo_trial: number; demo_positif: number; so: number; faktur: number;
  };
  brand_corong: string[];
  per_am: BarisAm[];
  per_item: { item_id: string; nama: string; brand: string | null; netto: number; qty: number }[];
  hari_ini: string;
  dihitung_sampai: string;
  boleh_ubah: boolean;
}

export interface AmOpsi { am_id: string; nama: string; cabang: string | null }

export const STATUS_CLS: Record<StatusKampanye, string> = {
  "akan datang": "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  berjalan: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  selesai: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  dibatalkan: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
};

export const PACING_CLS: Record<NonNullable<Pacing["status"]>, string> = {
  "di depan": "text-emerald-700 dark:text-emerald-400",
  sesuai: "text-amber-700 dark:text-amber-400",
  tertinggal: "text-rose-700 dark:text-rose-400",
};

export const BAR_CLS: Record<NonNullable<Pacing["status"]> | "none", string> = {
  "di depan": "bg-emerald-500",
  sesuai: "bg-amber-500",
  tertinggal: "bg-rose-500",
  none: "bg-primary",
};

export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export function rp(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${Math.round(v / 1e6).toLocaleString("id-ID")} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

export const angka = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
export const persen = (p: number | null): string => (p == null ? "—" : `${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tgl(d: string): string {
  const [y, m, h] = d.split("-").map(Number);
  return `${h} ${BULAN[m - 1]} ${y}`;
}
export const periode = (k: { tanggal_mulai: string; tanggal_selesai: string }): string =>
  `${tgl(k.tanggal_mulai)} – ${tgl(k.tanggal_selesai)}`;
