// F18 Demo & Trial — tipe & label bersama (sumber kebenaran: apps/api/src/repo/demo-trial.ts).

export type JenisDT = "demo" | "trial";
export type HasilDT = "positif" | "netral" | "negatif";

export interface DemoTrial {
  id: string; jenis: JenisDT; kode: string; facility_name: string; account_id: string | null; deal_id: string | null;
  deal_stage: string | null; alat: string; brand: string | null; tanggal: string; tanggal_selesai: string | null;
  catatan: string | null; hasil: HasilDT | null; alasan_hasil: string | null; ditutup_at: string | null; ditutup_oleh: string | null;
  am_id: string | null; am_nama: string | null; cabang: string | null; source: string; created_by: string | null; created_at: string;
  lewat_selesai: boolean;
}
export interface BarisKonversi { kunci: string; jenis: JenisDT; total: number; ditutup: number; positif: number; netral: number; negatif: number; rate: number | null }
export interface DaftarDT { count: number; items: DemoTrial[]; konversi: BarisKonversi[]; per_jenis: BarisKonversi[] }
export interface AmOpsi { am_id: string; nama: string; cabang: string | null }

export const JENIS_LABEL: Record<JenisDT, string> = { demo: "Demo", trial: "Trial" };
export const JENIS_CLS: Record<JenisDT, string> = {
  demo: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  trial: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
};
export const HASIL_LABEL: Record<HasilDT, string> = { positif: "Positif", netral: "Netral", negatif: "Negatif" };
export const HASIL_CLS: Record<HasilDT, string> = {
  positif: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  netral: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  negatif: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
};

export const tglId = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T00:00:00Z")) : "—";

export class GagalKirim extends Error {
  constructor(message: string, public data: Record<string, unknown>) {
    super(message);
  }
}
export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GagalKirim(String(data.error ?? `gagal (HTTP ${res.status})`), data);
  return data as T;
}
