// F65 Leads — tipe & label bersama (sumber kebenaran: apps/api/src/repo/lead.ts).

export type StatusLead = "baru" | "dihubungi" | "dikonversi" | "ditolak";
export type SumberLead = "wa" | "web" | "pameran" | "referral" | "telepon" | "lpse" | "lainnya";

export interface Lead {
  id: string; kode: string; facility_name: string; city: string | null; account_id: string | null;
  kebutuhan: string | null; brand: string | null; product: string | null; product_category: string | null;
  estimate_amount: number | null; purchase_month: number | null; purchase_year: number | null;
  contact_name: string | null; contact_role: string | null; contact_phone: string | null; notes: string | null;
  bant_budget: boolean; bant_authority: boolean; bant_need: boolean; bant_timeline: boolean; bant_skor: number;
  qualified: boolean; source: SumberLead; source_detail: string | null; status: StatusLead; alasan_tolak: string | null;
  am_id: string | null; am_nama: string | null; pic_hod: string | null; pic_hod_nama: string | null;
  cabang: string | null; routing_via: string; deal_id: string | null; converted_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  hari_kerja_baru: number | null; basi: "am" | "hod" | null;
}
export interface Duplikat { jenis: "lead" | "deal"; ref: string; nama: string; status: string; am_id: string | null }
export interface AmOpsi { am_id: string; nama: string; cabang: string | null }

export const BANT_LOLOS = 3;

export const STATUS_LABEL: Record<StatusLead, string> = {
  baru: "Baru", dihubungi: "Dihubungi", dikonversi: "Jadi deal", ditolak: "Ditolak",
};
export const STATUS_CLS: Record<StatusLead, string> = {
  baru: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  dihubungi: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  dikonversi: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  ditolak: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
export const SUMBER_LABEL: Record<SumberLead, string> = {
  wa: "WhatsApp #LEADS", web: "Input web", pameran: "Pameran/seminar", referral: "Referral",
  telepon: "Telepon masuk", lpse: "LPSE/e-Katalog", lainnya: "Lainnya",
};
export const BANT: { k: "bant_budget" | "bant_authority" | "bant_need" | "bant_timeline"; l: string; d: string }[] = [
  { k: "bant_budget", l: "Budget", d: "Pagu/anggaran untuk pembelian ini ada" },
  { k: "bant_authority", l: "Authority", d: "Sudah kenal pengambil keputusan (kepala lab/direktur/PPK)" },
  { k: "bant_need", l: "Need", d: "Kebutuhan alat/parameter jelas" },
  { k: "bant_timeline", l: "Timeline", d: "Perkiraan bulan beli diketahui" },
];

export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
