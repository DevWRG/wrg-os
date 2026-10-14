// F56 Onboarding Checklist — tipe & label bersama (sumber kebenaran: apps/api/src/repo/onboarding.ts).

export type Kategori = "akses_sistem" | "training" | "nda" | "alat" | "grup_wa";
export type ItemStatus = "belum" | "selesai" | "dilewati";
export type CaseStatus = "berjalan" | "selesai" | "dibatalkan";

export interface Progress { total: number; selesai: number; dilewati: number; belum: number; terlambat: number; persen: number }
export interface OnboardingCase {
  id: number; employee_id: string; nama: string; role: string | null; dept: string | null; cabang: string | null;
  tanggal_mulai: string; status: CaseStatus; catatan: string | null; created_by: string | null;
  created_at: string; selesai_at: string | null; progress: Progress;
}
export interface OnboardingItem {
  id: number; case_id: number; kategori: Kategori; judul: string; keterangan: string | null; pic: string | null;
  urut: number; due_date: string; status: ItemStatus; catatan: string | null; done_by: string | null; done_at: string | null;
  terlambat: boolean;
}
export interface Candidate { id: string; nama: string; role: string | null; dept: string | null; cabang: string | null; roster_pending: boolean }
export interface Template {
  id: number; kategori: Kategori; judul: string; keterangan: string | null; dept: string | null; dept_label: string | null;
  role_pattern: string | null; due_days: number; pic: string | null; urut: number; aktif: boolean;
}

export const KATEGORI: Kategori[] = ["akses_sistem", "training", "nda", "alat", "grup_wa"];
export const KATEGORI_LABEL: Record<Kategori, string> = {
  akses_sistem: "Akses sistem", training: "Training", nda: "NDA", alat: "Alat", grup_wa: "Grup WA",
};
export const CASE_LABEL: Record<CaseStatus, string> = { berjalan: "Berjalan", selesai: "Selesai", dibatalkan: "Dibatalkan" };
export const CASE_CLS: Record<CaseStatus, string> = {
  berjalan: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  dibatalkan: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
export const ITEM_CLS: Record<ItemStatus, string> = {
  belum: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  dilewati: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

export const tglId = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T00:00:00Z")) : "—";
export const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

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
