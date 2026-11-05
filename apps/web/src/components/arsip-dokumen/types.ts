// F156 Arsip Dokumen — tipe & helper layar. Bentuk data = apps/api/src/repo/arsip-dokumen.ts.

export interface Buku { kode: string; nama: string; keterangan: string | null; aktif: boolean; dipakai: number }

export interface Arsip {
  id: number; nomor: string; buku_kode: string; buku_nama: string; tanggal_dokumen: string; judul: string;
  akun: string | null; lokasi_fisik: string | null; keterangan: string | null;
  ref_faktur: string | null; ref_sj: string | null; ref_po: string | null; ref_sn: string | null;
  nama_asli: string; mime: string; ukuran: number; diunggah_oleh: string | null; diunggah_at: string;
  diubah_oleh: string | null; diubah_at: string | null;
}
export interface DaftarArsip { count: number; total_rows: number; limit: number; offset: number; items: Arsip[] }

export const REF: { key: "ref_faktur" | "ref_sj" | "ref_po" | "ref_sn"; label: string; contoh: string }[] = [
  { key: "ref_faktur", label: "No. faktur", contoh: "PJK/2190-2610-LMG" },
  { key: "ref_sj", label: "No. SJ / DO", contoh: "SJ/2026/11/0123" },
  { key: "ref_po", label: "No. PO / penerimaan", contoh: "PO/2026/10/045" },
  { key: "ref_sn", label: "Serial number alat", contoh: "SN 12345678" },
];

export const MAKS_BERKAS = 8 * 1024 * 1024;

export const tgl = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00+07:00" : s).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" }) : "—";
export const ukuranTeks = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const hariIni = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

/** fetch JSON + pesan galat dari apps/api apa adanya. */
export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`)), { data });
  return data as T;
}
export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
