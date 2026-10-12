// Bentuk data F34 Aset Tetap — cermin apps/api/src/repo/asetTetap.ts.

export interface AsetTetapRow {
  id: number;
  number: string;
  prefix: string | null;
  description: string | null;
  fa_type_name: string | null;
  disposed: boolean;
  asset_cost: number | null;
  current_asset_cost: number | null;
  book_value: number | null;
  residu: number | null;
  akumulasi: number;
  susut_per_bulan: number | null;
  sisa_bulan: number | null;
  habis_susut: boolean;
  depreciation_method: string | null;
  current_estimated_life: number | null;
  trans_date: string | null;
  current_start_date: string | null;
  last_journal_date: string | null;
  tgl_perolehan_asli: string | null;
  kso_asset_id: number | null;
  catatan_finance: string | null;
}

export interface DaftarAset {
  count: number;
  total_rows: number;
  limit: number;
  offset: number;
  rows: AsetTetapRow[];
}

export interface Kelompok {
  prefix: string | null;
  fa_type_name: string | null;
  jumlah: number;
  disposed: number;
  habis_susut: number;
  nilai_perolehan: number;
  nilai_buku: number;
  akumulasi: number;
  susut_per_bulan: number;
}

export interface Ringkasan {
  per_kelompok: Kelompok[];
  total: { jumlah: number; disposed: number; nilai_perolehan: number; nilai_buku: number; akumulasi: number; susut_per_bulan: number };
  tipe: string[];
  sync: { last_synced_at: string | null; last_run_ok: boolean | null; summary: unknown };
}

export interface JadwalBaris { periode: string; susut: number; akumulasi: number; nilai_buku: number; status: "lewat" | "berjalan" | "proyeksi" }

export type DetailAset =
  | { ok: true; aset: AsetTetapRow; jadwal: JadwalBaris[]; catatan: string | null }
  | { ok: false; error: string };

// Label prefiks nomor Accurate (sebaran prod 12 Okt: KSO 1.165 · INK 215 ·
// VHC 9 · TNH 2 · GDG 2). Prefiks lain tampil apa adanya.
export const PREFIX_LABEL: Record<string, string> = {
  KSO: "Alat KSO", INK: "Inventaris kantor", VHC: "Kendaraan", TNH: "Tanah", GDG: "Gedung",
};

export const rp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
export const rpC = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
export const tgl = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
export const bulan = (periode: string) => {
  const d = new Date(`${periode}-15T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? periode : d.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
};

/** fetch JSON; pesan error dari apps/api diteruskan apa adanya. */
export async function ambil<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}
