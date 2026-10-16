// F170 Komite KSO — tipe & helper layar. Bentuk data = apps/api/src/repo/kso-komite.ts.
import type { TabKso } from "@/lib/kso-komite-access";

export interface TabBoleh { tab: TabKso; bolehAksi: boolean }

export interface Ringkasan {
  total_diajukan: number; menunggu_hod: number; menunggu_forum: number; menunggu_direksi: number;
  siap_penawaran: number; ditahan: number; total_jalur_cepat: number; total_jalur_forum: number; capex_disetujui: number;
}

export interface BarisAntrean {
  antrean: string; id: number; nomor: string | null; status: string; faskes_nama: string; alat_nama: string;
  capex: number; sejak: string | null; batas: string | null; am_nama: string; cabang: string | null;
  jalur: string | null; pola_gerbang: string | null; gerbang_merah: string | null; volume_sumber: string | null;
}

export interface BarisAgenda {
  forum_id: number; tanggal: string; hari: string; mode: string; jenis: string | null; urut: number | null;
  rencana_id: number | null; nomor: string | null; am_nama: string | null; faskes_nama: string | null; alat_nama: string | null;
  capex: number | null; pola_gerbang: string | null; gerbang_merah: string | null; status: string | null; pendapat_hod_masuk: number | null;
}

export type BarisKpi = Record<string, string | number | null> & { am_id: string; am_nama: string; periode: string };

export interface DataTab { tab: TabKso; ringkasan: Ringkasan; baris?: BarisAntrean[]; agenda?: BarisAgenda[]; kpi?: BarisKpi[] }

export interface Detail {
  rencana: Record<string, unknown> & {
    id: number; nomor: string | null; status: string; jalur: string | null; am_nama: string; faskes_nama: string; cabang: string | null;
    alat_nama: string; jumlah: number; capex: number; volume_estimasi: number | null; volume_sumber: string | null;
    harga_per_test: number | null; tenor_bulan: number | null; alasan_forum: string | null; payback_bulan: number | null;
  };
  gerbang: { no: number; nama: string; status: string; nilai: string | null }[];
  pendukung: { nama: string; tipe: string; kontak_terakhir_tanggal: string | null; kontak_terakhir_cara: string | null }[];
  klausul: { kode: string; label: string }[];
  pendapat: { hod_id: string; hod_nama: string | null; jenis: string; keputusan: string | null; catatan: string | null; dianggap_setuju: boolean; at: string }[];
  mandat: { harga_lantai: number; harga_target: number | null; tenor_maks_bulan: number; capex_maks: number; volume_minimum: number | null; berlaku_sampai: string; sumber: string } | null;
  usulan: { usulan: string; syarat: { isi: string; tipe: string }[] | null; data_kurang: string | null; pemilik: string | null; tanggal_kembali: string | null; alasan: string | null; at: string }[];
  putusan: { putusan: string; catatan: string | null; at: string } | null;
  riwayat: { dari: string | null; ke: string; oleh: string | null; oleh_peran: string | null; oleh_nama: string | null; at: string }[];
  forum: { forum_id: number; tanggal: string } | null;
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", DIAJUKAN: "Diajukan", JALUR_CEPAT: "Jalur cepat", JALUR_FORUM: "Jalur forum", DIAGENDAKAN: "Diagendakan",
  DITAHAN: "Ditahan", DIREKOMENDASIKAN: "Direkomendasikan", DIREKOMENDASIKAN_BERSYARAT: "Direkomendasikan bersyarat",
  TIDAK_DIREKOMENDASIKAN: "Tidak direkomendasikan", DIPUTUS_HOD: "Diputus HOD", DITOLAK_HOD: "Ditolak HOD",
  MANDAT_TERBIT: "Mandat terbit", DITOLAK_DIREKSI: "Ditolak Direksi", PENAWARAN_TERBIT: "Penawaran terbit",
  PKS_TTD: "PKS ditandatangani", TERPASANG: "Terpasang", KALAH: "Kalah",
};

// chip status: warna/10 + teks warna-600 (bg-muted tak terlihat di mode terang — standar UI)
export const GERBANG_CLS: Record<string, string> = {
  hijau: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  merah: "bg-red-500/10 text-red-700 dark:text-red-400",
  belum: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};
export const GERBANG_IKON: Record<string, string> = { hijau: "✓", merah: "✕", belum: "?" };
export const POLA_STATUS: Record<string, string> = { h: "hijau", m: "merah", b: "belum" };

export const rp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
export const rpJt = (n: number | null | undefined) =>
  n == null ? "—" : `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
export const waktu = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/** fetch JSON + pesan galat dari apps/api apa adanya (sudah diterjemahkan ke bahasa manusia di sana). */
export async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
