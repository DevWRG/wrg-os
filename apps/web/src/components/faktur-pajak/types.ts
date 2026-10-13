// F27 Faktur Pajak / CoreTax — tipe & label bersama (sumber kebenaran: apps/api/src/repo/faktur-pajak.ts).

export type FpStatus = "diminta" | "diinput_coretax" | "disetujui" | "selesai" | "dibatalkan";

export interface FpRow {
  id: number; invoice_id: number; invoice_number: string; customer_id: number | null; customer_name: string | null;
  customer_npwp: string | null; tanggal_invoice: string; dpp: number; ppn: number; masa_pajak: string; batas_terbit: string;
  status: FpStatus; nomor_fp: string | null; bukti_url: string | null; catatan: string | null; requested_by: string | null;
  created_at: string; updated_at: string; terlambat: boolean;
}
export interface FpEvent { id: number; dari: FpStatus | null; ke: FpStatus; oleh: string | null; catatan: string | null; at: string }
export type FpDetail = FpRow & { events: FpEvent[] };
export interface Ringkasan { total: number; per_status: Record<FpStatus, number>; terlambat: number }
export interface Kandidat {
  invoice_id: number; invoice_number: string; tanggal: string; customer_name: string | null; customer_npwp: string | null;
  dpp: number; ppn: number; batas_terbit: string; terlambat: boolean;
}

export const STATUS_LABEL: Record<FpStatus, string> = {
  diminta: "Diminta", diinput_coretax: "Diinput CoreTax", disetujui: "Disetujui", selesai: "Selesai (bukti)", dibatalkan: "Dibatalkan",
};
export const STATUS_CLS: Record<FpStatus, string> = {
  diminta: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  diinput_coretax: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  disetujui: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  dibatalkan: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
/** Langkah maju berikutnya (cermin PINDAH di api; selesai/dibatalkan final). */
export const LANGKAH_MAJU: Partial<Record<FpStatus, { ke: FpStatus; label: string }>> = {
  diminta: { ke: "diinput_coretax", label: "Tandai sudah diinput di CoreTax" },
  diinput_coretax: { ke: "disetujui", label: "Setujui & catat nomor FP" },
  disetujui: { ke: "selesai", label: "Selesaikan dengan bukti" },
};
export const LANGKAH_MUNDUR: Partial<Record<FpStatus, FpStatus>> = { diinput_coretax: "diminta", disetujui: "diinput_coretax" };

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
