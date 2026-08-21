// Tipe respons + format tampilan Insentif (F67). Bentuknya mengikuti
// apps/api/src/repo/insentif.ts — kalau di sana berubah, ubah di sini juga.

/** Satu baris rekap bulanan per AM (insentif_bulanan). */
export interface BarisBulanan {
  am_id: string;
  nama: string;
  panggilan: string | null;
  periode: string;
  tier_ut: string;
  total_insentif_am: number;
  total_insentif_ho: number;
  dibayar: number;
  retention_pool: number;
  cap_bulanan: number;
  status: string;
  transaksi: number;
}

/** Satu transaksi (insentif_transaksi) — unit hitung model console_v2. */
export interface BarisTransaksi {
  invoice_no: string;
  tanggal: string;
  customer_id: string | null;
  revenue: number;
  gp_actual_pct: number | null;
  aging_days: number | null;
  ncr_type: string;
  lead_type: string;
  mr_pct: number;
  ncr_pct: number;
  cf: number;
  pengali: number;
  insentif_am: number;
  insentif_ho: number;
}

export type SelfResult =
  | { linked: false; message: string }
  | {
      linked: true;
      periode: string;
      scope: "self";
      ringkas: BarisBulanan | null;
      transaksi: BarisTransaksi[];
    };

export interface TimResult {
  periode: string;
  scope: "self" | "team" | "all";
  baris: BarisBulanan[];
  total_am: number;
  total_ho: number;
}

const idr = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export const rupiah = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "—" : `Rp ${idr.format(Math.round(n))}`;

export const angka = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? "—" : idr.format(n);

/** Persen dengan 1 desimal. null → em dash, BUKAN "0%" — nol dan tak-diketahui beda. */
export const persen = (n: number | null | undefined, desimal = 1): string =>
  n == null || Number.isNaN(n) ? "—" : `${n.toFixed(desimal)}%`;

export const periodeLabel = (periode: string): string => {
  const [y, m] = periode.split("-");
  const bulan = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const i = Number(m) - 1;
  return i >= 0 && i < 12 ? `${bulan[i]} ${y}` : periode;
};

export const periodeSekarang = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const periodeSah = (p?: string | null): string =>
  p && /^\d{4}-\d{2}$/.test(p) ? p : periodeSekarang();

/** Tanggal ISO/date → "12 Jun 2026". */
export const tanggalSingkat = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

// ── Penjelasan nilai "tak diketahui" ────────────────────────────────────────
// Dua kondisi ini SENGAJA tidak dibulatkan jadi nol di backend, jadi UI juga tak
// boleh menyembunyikannya: kalau GP tak bisa diturunkan, MR = 0 karena tak diketahui,
// bukan karena marginnya nol. Menampilkannya sebagai "0%" membuat AM menyangka
// marginnya jeblok, dan menyembunyikan bahwa yang perlu dibenahi adalah price book.

export const gpLabel = (gp: number | null): string =>
  gp == null ? "tak diketahui" : persen(gp);

export const gpHint = (gp: number | null): string | null =>
  gp == null
    ? "HPP tak ketemu untuk semua baris invoice (atau kodenya ber-HPP ganda) → Margin Reward 0. Benahi di Price Book, jangan ditebak."
    : null;

export const agingLabel = (hari: number | null): string =>
  hari == null ? "tak diketahui" : `${hari} hari`;

export const agingHint = (hari: number | null): string | null =>
  hari == null
    ? "Tanggal pelunasan tak tercatat (invoice sudah lunas sebelum kolomnya ada) → Collection Factor diperlakukan netral 1,00, bukan dihukum."
    : null;

/** Label + warna status rantai persetujuan (insentif_bulanan.status). */
export function statusTone(status: string): {
  label: string;
  tone: "netral" | "jalan" | "selesai" | "tahan";
} {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "draft") return { label: "Draft", tone: "netral" };
  if (s === "dibayar" || s === "paid") return { label: "Dibayar", tone: "selesai" };
  if (s === "hold" || s === "ditahan") return { label: "Ditahan", tone: "tahan" };
  return { label: status || "—", tone: "jalan" };
}
