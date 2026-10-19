export interface BuktiRow {
  id: string;
  kode_pengajuan: string;
  catatan: string | null;
  nama: string;
  mime: string;
  ukuran: number;
  oleh: string | null;
  diunggah_at: string;
}

export interface DaftarBukti {
  total: number;
  items: BuktiRow[];
}

export const MAKS_BYTES = 8 * 1024 * 1024; // sama dengan MAKS_BUKTI di apps/api

export const ukuranTeks = (b: number): string =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/** fetch JSON; galat API ({error}) dilempar sebagai Error berpesan apa adanya. */
export async function ambil<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Gagal (${res.status})`);
  return data;
}
