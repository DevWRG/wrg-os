// F171 Permintaan Produk — tipe & helper layar. Bentuk data = apps/api/src/repo/permintaan-produk.ts.

export type Cek = "belum_dicek" | "ada" | "substitusi" | "belum_ada";
export type Keputusan = "masuk_master" | "principal_baru" | "tolak";

export const LABEL_CEK: Record<Cek, string> = { belum_dicek: "Belum dicek", ada: "Ada di master", substitusi: "Bisa substitusi", belum_ada: "Belum ada" };
// chip status: warna/10 + teks warna-700 (bg-muted tak terlihat di mode terang — standar UI)
export const CLS_CEK: Record<Cek, string> = {
  belum_dicek: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ada: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  substitusi: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  belum_ada: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};
export const LABEL_KEPUTUSAN: Record<Keputusan, string> = { masuk_master: "Masuk master", principal_baru: "Principal baru", tolak: "Tolak" };
export const LABEL_SUMBER: Record<string, string> = { wa: "WhatsApp", kunjungan: "Kunjungan", telepon: "Telepon", tender: "Tender", email: "Email", lainnya: "Lainnya" };

export interface Permintaan {
  id: number; tanggal_minta: string; pengaju: string; am_id: string | null; account_id: number | null; faskes_nama: string;
  produk_diminta: string; merek: string | null; qty_bulan: number | null; satuan: string | null; harga_satuan: number | null;
  sumber: string; cek_master: Cek; sku_kode: string | null; sku_nama: string | null; kelompok_id: number | null; kelompok_nama: string | null;
  catatan: string | null; dicatat_oleh: string; dicatat_at: string; hari_kerja_catat: number; terlambat: boolean;
}
export interface DaftarLog { count: number; total_rows: number; limit: number; offset: number; sla_hari_kerja: number; items: Permintaan[] }

export interface Param { kandidat_min_faskes: number; kandidat_hari: number; kandidat_min_potensi: number; sla_hari_kerja: number }
export interface Kelompok {
  id: number; nama: string; catatan: string | null; total_semua: number; permintaan: number; faskes_unik: number;
  belum_ada: number; substitusi: number; belum_dicek: number; harga_median: number | null; potensi_tahun: number | null;
  faskes_tanpa_angka: number; kandidat: boolean;
  review_terakhir: { kuartal: string; usulan: Keputusan; putusan: Keputusan | null } | null;
}
export interface Analisa { param: Param; hari_ini: string; kelompok: Kelompok[]; tanpa_kelompok: number; tren: { bulan: string; permintaan: number; faskes: number }[] }

export interface Review {
  id: number; kelompok_id: number; kelompok_nama: string; kuartal: string; usulan: Keputusan; usulan_catatan: string; usulan_oleh: string;
  usulan_at: string; snapshot: Partial<Kelompok>; putusan: Keputusan | null; putusan_catatan: string | null; putusan_oleh: string | null; putusan_at: string | null;
}
export interface DaftarReview { kuartal_sekarang: string; items: Review[] }

export interface Opsi { am: { am_id: string; nama: string; cabang: string | null }[]; kelompok: { id: number; nama: string }[]; param: Param }

export const rp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
export const rpJt = (n: number | null | undefined) =>
  n == null ? "—" : `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
export const tgl = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00+07:00" : s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }) : "—";

/** fetch JSON + pesan galat dari apps/api apa adanya. */
export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`)), { data });
  return data as T;
}
export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
