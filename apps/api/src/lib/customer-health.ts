// F17 — Customer Health Cards: label per akun (faskes) yang dihitung dari
// faktur Accurate. SENGAJA aturan deterministik, bukan klasifikasi LLM seperti
// tertulis di PRD Sales Batch 3 (keputusan user 11 Okt 2026): label yang
// dibaca AM & HoD harus bisa ditelusuri ke angka dan tidak berubah kalau
// datanya tidak berubah.
//
// Dua label terpisah:
//   1. Kelas HOT / WARM / COLD — semua akun ber-faktur.
//   2. Status KSO — hanya akun yang punya alat KSO operasional
//      (kso_asset_status_v.status_kode = 'operasional').

/** HOT hanya untuk akun yang order dalam 30 hari terakhir. */
export const HOT_MAX_DAYS = 30;
/**
 * Lewat 60 hari tanpa order = COLD. Sama dengan ambang dorman/churn yang sudah
 * dipakai di tempat lain (DORMANT_DAYS di repo/sales.ts untuk F77 Churn, dan
 * churnRutin di repo/watchpoint.ts) — supaya akun yang di /accounts COLD juga
 * yang dihitung churn di WatchPoint, bukan definisi ketiga yang menyimpang.
 */
export const WARM_MAX_DAYS = 60;

export type KelasHealth = "HOT" | "WARM" | "COLD";

/**
 * "Frekuensi turun" = definisi tier `risk` F77 Churn (classifyChurn di
 * repo/sales.ts): baseline 90 hari sebelumnya minimal 2 faktur, dan 90 hari
 * terakhir kurang dari SEPARUHNYA. Dipakai ulang persis supaya akun yang
 * "turun" di /accounts sama dengan yang "risk" di tab Churn. Versi pertama F17
 * memakai recent < prior — terlalu sensitif: RSUD Perfect Rutin dengan 17 vs 19
 * faktur jatuh ke WARM (uji data prod 11 Okt 2026).
 */
export function frekuensiTurun(recent90: number, prior90: number): boolean {
  return prior90 >= 2 && recent90 < prior90 * 0.5;
}

export interface HealthInput {
  /** Hari sejak faktur terakhir. null = belum pernah ada faktur. */
  daysSince: number | null;
  /** Jumlah faktur 90 hari terakhir. */
  recent90: number;
  /** Jumlah faktur 90 hari sebelumnya (hari ke-91 s/d 180). */
  prior90: number;
}

export interface HasilHealth {
  kelas: KelasHealth;
  alasan: string;
}

/**
 * HOT  = order ≤30 hari DAN frekuensi tidak turun (lihat frekuensiTurun).
 * WARM = order ≤60 hari (termasuk yang baru order tapi frekuensinya turun).
 * COLD = lewat 60 hari tanpa order, atau belum pernah order.
 */
export function kelasHealth(h: HealthInput): HasilHealth {
  if (h.daysSince == null) return { kelas: "COLD", alasan: "belum ada faktur" };
  const tren = `${h.recent90} faktur 90 hari terakhir vs ${h.prior90} sebelumnya`;
  const turun = frekuensiTurun(h.recent90, h.prior90);
  if (h.daysSince <= HOT_MAX_DAYS && !turun) {
    return { kelas: "HOT", alasan: `order ${h.daysSince} hari lalu · ${tren}` };
  }
  if (h.daysSince <= WARM_MAX_DAYS) {
    const catatan = turun ? " — frekuensi turun lebih dari separuh" : "";
    return { kelas: "WARM", alasan: `order ${h.daysSince} hari lalu · ${tren}${catatan}` };
  }
  return { kelas: "COLD", alasan: `tidak order ${h.daysSince} hari` };
}

export interface JendelaKso {
  /** Awal jendela (inklusif), YYYY-MM-DD. */
  mulai: string;
  /** Akhir jendela (eksklusif) = tanggal 1 bulan berjalan, YYYY-MM-DD. */
  akhir: string;
  /** Jumlah bulan yang sudah tutup di dalam jendela. */
  bulanTutup: number;
  /** Teks label "Tidak beli …", mis. "2026" atau "3 bln terakhir". */
  labelPeriode: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number) => `${y}-${pad(m)}-01`;

/**
 * Jendela status KSO = bulan-bulan yang sudah TUTUP di tahun berjalan (Jan s/d
 * bulan lalu). Bulan berjalan sengaja tak dihitung: tanggal 5 belum belanja
 * bukan berarti bulan itu bolong. Januari belum punya bulan tutup → pakai 3
 * bulan tutup terakhir (Okt–Des tahun lalu) supaya label tak kosong sebulan.
 * `today` dalam WIB (string YYYY-MM-DD) — tanggal, bukan Date, supaya tak
 * bergeser zona waktu.
 */
export function jendelaKso(today: string): JendelaKso {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const akhir = ymd(y, m);
  if (m === 1) {
    return { mulai: ymd(y - 1, 10), akhir, bulanTutup: 3, labelPeriode: "3 bln terakhir" };
  }
  return { mulai: ymd(y, 1), akhir, bulanTutup: m - 1, labelPeriode: String(y) };
}

export type StatusKso = "PERFECT_RUTIN" | "SESEKALI" | "TIDAK_BELI";

export interface HasilKso {
  status: StatusKso;
  label: string;
  alasan: string;
}

/**
 * Hanya untuk akun ber-alat KSO operasional (selain itu null).
 * Perfect Rutin = belanja di SETIAP bulan tutup jendela; Sesekali = sebagian;
 * Tidak beli = nol bulan. Data prod 11 Okt 2026 (Jan–Sep): 79 · 92 · 25 akun.
 */
export function statusKso(punyaKso: boolean, bulanBelanja: number, j: JendelaKso): HasilKso | null {
  if (!punyaKso) return null;
  const dari = `${bulanBelanja}/${j.bulanTutup} bulan`;
  if (bulanBelanja <= 0) {
    return { status: "TIDAK_BELI", label: `Tidak beli ${j.labelPeriode}`, alasan: `0/${j.bulanTutup} bulan ada faktur` };
  }
  if (bulanBelanja >= j.bulanTutup) {
    return { status: "PERFECT_RUTIN", label: "Perfect Rutin", alasan: `${dari} ada faktur` };
  }
  return { status: "SESEKALI", label: "Sesekali", alasan: `${dari} ada faktur` };
}
