// F47 Kontrak KSO — tipe & label bersama. Bentuk data = apps/api/src/repo/kso-kontrak.ts.

export type StatusKontrak = "AKTIF" | "NEGO" | "RENEWED" | "LOST";
export type Bucket = "LEWAT" | "H30" | "H60" | "H90" | "H120" | "AMAN" | "TANPA_TANGGAL" | "SELESAI";

export interface Kontrak {
  id: string; nomor: string; account_id: string; account_nama: string; owner_nama: string | null;
  mulai: string | null; berakhir: string | null; sisa_hari: number | null; bucket: Bucket;
  nkt: number | null; auto_renew: boolean; pic_nama: string | null; status: StatusKontrak;
  terverifikasi: boolean; sumber: "isian_awal" | "manual"; jumlah_alat: number;
  diganti_oleh: string | null; catatan: string | null; updated_at: string;
}

export interface DaftarKontrak { kontrak: Kontrak[]; ringkasan: Record<Bucket, number>; belum_verifikasi: number }

export interface Kelengkapan {
  alat_tanpa_kontrak: { account_id: string; account_nama: string; jumlah_alat: number; kategori: "draft" | "kosong"; nomor_sheet: string | null }[];
  kontrak_tanpa_tanggal: Kontrak[];
  kontrak_tanggal_beda: (Kontrak & { tanggal_sheet: string })[];
}

export interface AlatKontrak {
  id: string; sn: string | null; nama_alat: string | null; skema?: string | null;
  nomor_sheet: string | null; berakhir_sheet?: string | null; status_label?: string | null;
}
export interface LogKontrak {
  aksi: string; dari_status: string | null; ke_status: string | null;
  perubahan: Record<string, unknown> | null; catatan: string | null; oleh: string | null; created_at: string;
}
export interface DetailKontrak { kontrak: Kontrak; alat: AlatKontrak[]; kandidat_alat: AlatKontrak[]; log: LogKontrak[] }

export interface AkunKso { id: string; nama: string; alat: { id: string; sn: string | null; nama_alat: string | null; nomor_sheet: string | null; berkontrak: boolean }[] }

export const BUCKET_LABEL: Record<Bucket, string> = {
  LEWAT: "Sudah lewat", H30: "≤ 30 hari", H60: "31–60 hari", H90: "61–90 hari", H120: "91–120 hari",
  AMAN: "> 120 hari", TANPA_TANGGAL: "Tanpa tanggal", SELESAI: "Selesai",
};
// Token warna sama dengan chip status WatchPoint/Health (…/10 + teks 600) — bukan bg-muted.
export const BUCKET_CLS: Record<Bucket, string> = {
  LEWAT: "bg-destructive/10 text-destructive",
  H30: "bg-destructive/10 text-destructive",
  H60: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  H90: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  H120: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  AMAN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  TANPA_TANGGAL: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  SELESAI: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
};
export const STATUS_LABEL: Record<StatusKontrak, string> = { AKTIF: "Aktif", NEGO: "Negosiasi", RENEWED: "Diperpanjang", LOST: "Tidak diperpanjang" };

export const rpC = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
export const sisaTeks = (k: Pick<Kontrak, "sisa_hari" | "bucket">) =>
  k.bucket === "SELESAI" ? "—" : k.sisa_hari == null ? "tanpa tanggal" : k.sisa_hari < 0 ? `lewat ${-k.sisa_hari} hari` : `${k.sisa_hari} hari lagi`;

/** fetch JSON + error yang terbaca (pesan dari apps/api diteruskan apa adanya). */
export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
