// F131 Customer Intelligence — tipe bersama (cermin apps/api/src/repo/customer-intel.ts).

export interface Briefing {
  faskes: { ids: string[]; nama: string; cabang: string | null; tipe: string | null; kelas_rs: string | null; pemilik: string | null };
  kontak: { nama: string; jabatan: string | null; hp_wa: string | null; utama: boolean }[];
  pembelian: { terakhir: string | null; hari_sejak: number | null; netto_12bln: number; faktur_12bln: number; brand_teratas: string[] };
  piutang: { sisa: number; lewat_tempo: { faktur: number; nilai: number; terlama_hari: number } };
  bayar: { faktur: number; median_hari: number | null; rata_hari: number | null; tepat_pct: number | null; rata_telat_hari: number | null; tren: "lebih cepat" | "lebih lambat" | "stabil" | null };
  kunjungan: { tanggal: string; am: string | null; tujuan: string | null; hasil: string | null; next_action: string | null }[];
  catatan: { tanggal: string; jenis: string; isi: string; oleh: string }[];
  deal: { stage: string; brand: string | null; produk: string | null; nilai: number | null; hari_di_tahap: number | null; am: string | null }[];
  kso: { aktif: number; alat: string[]; mou_terdekat: string | null };
  kso_kesehatan: { status: "SEHAT" | "WASPADA" | "KRITIS"; alasan: string[] } | null;
  demo: { kode: string; jenis: string; alat: string; tanggal: string; tanggal_selesai: string | null }[];
  kompetitor: { tanggal: string; vendor: string; produk: string | null; harga_text: string | null; konteks: string | null }[];
  dominan_wilayah: { kategori: string; vendor: string; catatan: string | null }[];
  hari_ini: string;
}

export interface SelDominasi {
  cabang: string;
  kategori: string;
  total: number;
  vendor: string;
  sebutan: number;
  pangsa: number;
  runner_up: { vendor: string; sebutan: number } | null;
  dugaan: boolean;
  status: "dikonfirmasi" | "ditolak" | null;
  catatan: string | null;
  oleh: string | null;
}

export function rp(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${Math.round(v / 1e6).toLocaleString("id-ID")} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function tgl(d: string, tahun = false): string {
  const [y, m, h] = d.split("-").map(Number);
  return `${h} ${BULAN[m - 1]}${tahun ? ` ${y}` : ""}`;
}
