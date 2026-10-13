// F130 Brosur & Video — cermin apps/api/src/repo/materi.ts.
export type JenisMateri = "brosur" | "video";
export const KATEGORI = ["IVD", "Medical", "Aftersales", "Lainnya"] as const;

export interface Materi {
  id: string;
  kode: string;
  jenis: JenisMateri;
  judul: string;
  brand: string | null;
  kategori: string | null;
  produk: string | null;
  url: string;
  file_name: string | null;
  file_size: number | null;
  catatan: string | null;
  aktif: boolean;
  akses_publik: boolean | null;
  updated_by: string | null;
  updated_at: string;
}

export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
