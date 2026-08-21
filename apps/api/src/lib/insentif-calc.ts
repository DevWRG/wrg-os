// F67 Sales Incentive Engine — perhitungan murni (TANPA akses DB).
//
// MODEL KANONIK: `wrg_incentive_console_v2.jsx` fungsi `calcTransaction()`.
// Keputusan pemilik produk 2026-08-09: yang dibangun model tiga berkas Direktur,
// BUKAN SK/WRG/Sales/001/V/2026 Pasal 4. Spec: PRD-S3-Insentif-Simulator-v2.md v3.0 §A.2.
//
// ⚠️ SK Pasal 4 MASIH BERLAKU dan rumusnya berbeda (revenue × rate% golongan). Addendum
// atau revisi SK wajib terbit sebelum pembayaran pertama. Jangan ubah konstanta di bawah
// tanpa keputusan Direktur — angkanya menentukan berapa rupiah yang cair.
//
// Unit hitung = PER TRANSAKSI (satu invoice), bukan agregat bulanan. MR, CF, tipe
// customer baru, dan tipe lead melekat pada masing-masing invoice. Hanya Effort &
// Presales yang global per AM per bulan.

export const HARGA_POIN: Record<string, number> = {
  OSP: 60, P0: 90, P1: 94, P2: 98, P3: 103, C1: 110, C2: 117, C3: 126,
};

/** Poin per Rupiah revenue. DATAR untuk semua SKU — lihat catatan di akhir berkas. */
export const PI_PER_RUPIAH = 0.0000640;

/** Target GP flat 30%. Model SK menyerahkannya ke HOD Finance per outlet per semester; model ini tidak. */
export const GP_TARGET_DEFAULT = 30;

/** Bagi hasil per tipe lead. Sisanya (1 − share) mengalir ke HO Pool. */
export const LEAD_SHARE = { A: 1.0, B: 0.3, C: 0.15 } as const;

/** NCR menambah PERSEN ke pengali (bukan Rupiah seperti SK). Berlaku 3 bulan pertama. */
export const NCR_PCT = { existing: 0, reaktivasi: 20, newMurni: 30 } as const;

export type TierUt = keyof typeof HARGA_POIN;
export type LeadType = keyof typeof LEAD_SHARE;
export type NcrType = keyof typeof NCR_PCT;

/**
 * Margin Reward — linier, dibatasi 0-35.
 * KSO dapat 0 (margin sudah tinggi karena investasi alat); ECAT/Price List juga 0 (harga fixed).
 */
export function marginReward(
  gpActualPct: number,
  gpTargetPct: number,
  isKso: boolean,
  isEcatPl: boolean,
): number {
  if (isKso || isEcatPl) return 0;
  return Math.max(0, Math.min(35, (gpActualPct - gpTargetPct) * 2.5));
}

/** Collection Factor — 5 tingkat, dari umur piutang invoice itu sendiri. */
export function collectionFactor(agingDays: number): number {
  if (agingDays <= 10) return 1.05;
  if (agingDays <= 30) return 1.0;
  if (agingDays <= 60) return 0.9;
  if (agingDays <= 90) return 0.75;
  return 0.5;
}

export interface TrxInput {
  revenue: number;
  tier: TierUt;
  /** NULL bila HPP SKU belum ada → MR 0. Jangan ditebak: menebak margin = menebak gaji orang. */
  gpActualPct: number | null;
  gpTargetPct?: number;
  isKso?: boolean;
  isEcatPl?: boolean;
  agingDays: number;
  ncrType: NcrType;
  leadType: LeadType;
  /** 60-100, global per AM per bulan. */
  effort: number;
  /** 0-10, global per AM per bulan. */
  presales: number;
}

export interface TrxOutput {
  piPoints: number;
  hargaPoin: number;
  mrPct: number;
  ncrPct: number;
  cf: number;
  pengali: number;
  insentifRaw: number;
  insentifAm: number;
  insentifHo: number;
}

export function computeTransaksi(i: TrxInput): TrxOutput {
  const hargaPoin = HARGA_POIN[i.tier] ?? 0;
  const piPoints = i.revenue * PI_PER_RUPIAH;

  const mrPct =
    i.gpActualPct == null
      ? 0
      : marginReward(i.gpActualPct, i.gpTargetPct ?? GP_TARGET_DEFAULT, !!i.isKso, !!i.isEcatPl);

  const ncrPct = NCR_PCT[i.ncrType];
  const cf = collectionFactor(i.agingDays);

  // Pengali TIDAK di-cap. Berkas sumber menulis "max multiplier by design 1.75×", tapi
  // rumusnya sendiri bisa mencapai ±1.906× (MR 35 + NCR 30 = 1.65, × CF 1.05, × 1.10).
  // Memasang cap 1.75 di sini akan menyembunyikan selisih ~9% itu dari pengambil keputusan.
  // Hitung apa adanya; biarkan terlihat sampai Direktur memutuskan (PRD §L Q19).
  const pengali = (1 + mrPct / 100 + ncrPct / 100) * cf * ((i.effort + i.presales) / 100);

  const raw = piPoints * hargaPoin * pengali;
  const share = LEAD_SHARE[i.leadType];

  return {
    piPoints,
    hargaPoin,
    mrPct,
    ncrPct,
    cf,
    pengali,
    insentifRaw: Math.round(raw),
    insentifAm: Math.round(raw * share),
    insentifHo: Math.round(raw * (1 - share)),
  };
}

export interface RekapOutput {
  totalAm: number;
  totalHo: number;
  dibayar: number;
  retentionPool: number;
}

/**
 * Rekap bulanan: jumlahkan transaksi lalu terapkan batas bulanan.
 *
 * capBulanan = nilai batas (model: 2× gaji pokok). Yang disimpan di DB nilai batasnya,
 * BUKAN gaji pokok — data HR sensitif tak perlu masuk WRG-OS untuk ini.
 * Kelebihan di atas batas masuk retention pool, cair akhir tahun bila AM masih bekerja.
 */
export function rekapBulanan(
  trx: Pick<TrxOutput, "insentifAm" | "insentifHo">[],
  capBulanan: number,
): RekapOutput {
  const totalAm = trx.reduce((s, t) => s + t.insentifAm, 0);
  const totalHo = trx.reduce((s, t) => s + t.insentifHo, 0);
  return {
    totalAm,
    totalHo,
    dibayar: Math.min(totalAm, capBulanan),
    retentionPool: Math.max(0, totalAm - capBulanan),
  };
}

// ── Catatan yang tidak terbaca dari kode ──
//
// PI_PER_RUPIAH itu konstanta DATAR: poin hanya fungsi nilai rupiah, tidak melihat SKU.
// Ini menghapus sifat margin-weighted yang justru menjadi seluruh alasan sistem poin di
// `WRG_Levelling_Incentive.pdf` (di sana poin per SKU datang dari Master Product, jadi
// barang bermargin tebal memberi poin lebih besar per rupiah). Dengan konstanta datar,
// menjual barang margin tipis dan tebal menghasilkan poin sama — pembeda margin tinggal MR.
// Belum jelas ini disengaja atau penyederhanaan sementara (PRD §L Q20). Kalau nanti
// dikembalikan ke poin per SKU, yang berubah cuma perhitungan piPoints; sisanya tetap.
