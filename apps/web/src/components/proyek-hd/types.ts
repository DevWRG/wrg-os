// Tipe & helper bersama komponen Proyek HD (bentuk respons apps/api/src/repo/proyek-hd.ts).

export const SEGMEN = ["Kemenkes", "RSUD/Pemda", "TNI/Polri", "Swasta"] as const;
export const TIPE_PROYEK = ["Start New", "Pindah/Relokasi", "Tambah Unit", "Replacement"] as const;
export const PRIORITAS = ["Replace", "Gas", "Hold"] as const;
export const STATUS_RAG = ["Hijau", "Kuning", "Merah"] as const;

export interface Proyek {
  id: number; kode: string; account_id: number | null; faskes_nama: string | null; nama_rs: string; kota: string | null;
  segmen: string | null; tipe_proyek: (typeof TIPE_PROYEK)[number]; prioritas: string; nama_alat: string | null;
  unit_kso: number; unit_terinstal: number; unit_running: number; harga_unit: number | null;
  nomor_kontrak: string | null; target_tindakan_bln: number | null; target_golive: string | null;
  tahap_kode: string; tahap_nama: string; progres_pct: number; status_rag: string;
  pic_employee_id: string | null; pic_nama: string | null; next_action: string | null;
  diubah_oleh: string | null; diubah_at: string; dibuat_at: string;
}

export interface Ringkasan {
  kpi: {
    proyek: number; kso: number; terinstal: number; running: number; idle: number; kurang: number;
    dana: number; rasio: number | null; target_rasio: number | null; omset: number | null;
  };
  tahap: { kode: string; nama: string; posisi: number; jumlah: number }[];
}

export interface Lampiran { id: number; nama_asli: string; mime: string; ukuran: number }
export interface Catatan { id: number; tahap_kode: string; tanggal: string; catatan: string; oleh: string | null; dibuat_at: string; lampiran: Lampiran[] }
export interface KartuAlur { kode: string; nama: string; posisi: number; status: "selesai" | "berjalan" | "belum" }
export interface OpsiMaju { kode: string; nama: string; dilompati: string[]; utama: boolean }
export interface Riwayat { id: number; dari_tahap: string | null; ke_tahap: string; tanggal: string; oleh: string | null }

export interface Detail { proyek: Proyek; alur: KartuAlur[]; opsi_maju: OpsiMaju[]; catatan: Catatan[]; riwayat: Riwayat[] }

export interface Param { kunci: string; nilai: number | null; keterangan: string; urut: number; diubah_oleh: string | null; diubah_at: string | null }

export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export const rp = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `Rp ${Math.round(v).toLocaleString("id-ID")}`);

/** Ringkas untuk kartu: Rp 28,9 M / Rp 450 jt. */
export function rpRingkas(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const f = (x: number, d: number) => x.toLocaleString("id-ID", { maximumFractionDigits: d });
  if (Math.abs(v) >= 1e9) return `Rp ${f(v / 1e9, 2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${f(v / 1e6, 1)} jt`;
  return rp(v);
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tgl(s: string | null | undefined): string {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${+m[3]} ${BULAN[+m[2] - 1]} ${m[1]}` : "—";
}
export function bulan(s: string | null | undefined): string {
  const m = s ? /^(\d{4})-(\d{2})$/.exec(s) : null;
  return m ? `${BULAN[+m[2] - 1]} ${m[1]}` : s || "—";
}

export const RAG_KELAS: Record<string, string> = {
  Hijau: "bg-emerald-600 text-white",
  Kuning: "bg-amber-400 text-amber-950",
  Merah: "bg-destructive text-white",
};
