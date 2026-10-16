// F151 CN (Kredit Note) — tipe & label bersama (sumber kebenaran: apps/api/src/repo/cn.ts).
import type { CnStatus } from "@/lib/cn-access";

export type { CnStatus };
export type CnJenis = "persen" | "nominal";
export type KontrakStatus = "draft" | "aktif" | "dibatalkan";

export interface KontrakRow {
  id: number; kode: string; customer_id: number; customer_name: string; jenis: CnJenis; tarif: number;
  periode_mulai: string; periode_selesai: string; syarat: string | null; file_url: string | null;
  status: KontrakStatus; created_by: string | null; approved_by: string | null; created_at: string;
}
export interface CnRow {
  id: number; kode: string; kontrak_id: number; customer_id: number; customer_name: string; jenis: CnJenis; tarif: number;
  total_dpp: number; total_cn: number; hod_sales_key: string; hod_business_key: string | null; status: CnStatus;
  bukti_url: string | null; tanggal_realisasi: string | null; catatan: string | null; requested_by: string | null;
  created_at: string; updated_at: string;
}
export interface CnItem { invoice_id: number; invoice_number: string; tanggal_invoice: string; salesman_name: string | null; dpp: number; nilai_cn: number }
export interface CnEvent { id: number; dari: CnStatus | null; ke: CnStatus; oleh: string | null; catatan: string | null; at: string }
export type CnDetail = CnRow & { items: CnItem[]; events: CnEvent[] };
export interface Ringkasan { total: number; per_status: Record<CnStatus, number>; total_cn_berjalan: number; total_cn_terealisasi: number }
export interface FakturKandidat { invoice_id: number; invoice_number: string; tanggal: string; customer_id: number | null; dpp: number; salesman_name: string | null }
export interface LaporanBaris { kunci: string; label: string; jumlah_pengajuan: number; total_dpp: number; total_cn: number; total_terealisasi: number }

export const HOD_SALES = [{ value: "rocky", label: "Rocky — HoD Sales East" }, { value: "yogi", label: "Yogi — HoD Sales West" }];
export const HOD_BUSINESS = [{ value: "mufid", label: "Mufid — HoD Business IVD" }, { value: "arman", label: "Arman — HoD Business Medical" }];
export const HOD_NAMA: Record<string, string> = { rocky: "Rocky", yogi: "Yogi", mufid: "Mufid", arman: "Arman" };

export const STATUS_LABEL: Record<CnStatus, string> = {
  diajukan: "Diajukan", ditinjau: "Ditinjau HoD Business", disetujui: "Disetujui HoD Sales", divalidasi: "Divalidasi Finance",
  terealisasi: "Terealisasi (GA)", ditolak: "Ditolak", dibatalkan: "Dibatalkan",
};
export const STATUS_CLS: Record<CnStatus, string> = {
  diajukan: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  ditinjau: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  disetujui: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  divalidasi: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
  terealisasi: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  ditolak: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  dibatalkan: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
export const KONTRAK_CLS: Record<KontrakStatus, string> = {
  draft: STATUS_CLS.diajukan, aktif: STATUS_CLS.terealisasi, dibatalkan: STATUS_CLS.dibatalkan,
};
/** Teks tombol per langkah (cermin tujuanBerikut di api; server tetap memvalidasi). */
export const AKSI_LABEL: Record<CnStatus, string> = {
  diajukan: "", ditinjau: "Tandai sudah ditinjau", disetujui: "Setujui", divalidasi: "Validasi (Finance)",
  terealisasi: "Realisasikan (isi bukti transfer)", ditolak: "Tolak", dibatalkan: "Batalkan pengajuan",
};

export const tarifLabel = (jenis: CnJenis, tarif: number) => (jenis === "persen" ? `${tarif}% dari DPP faktur` : `${rupiah(tarif)} per pengajuan`);
export const tglId = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T00:00:00Z")) : "—";
export const rupiah = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

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
export const jsonInit = (method: string, body: Record<string, unknown>): RequestInit => ({
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
