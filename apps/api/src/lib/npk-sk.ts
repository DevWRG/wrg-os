// NPK — penilaian per aspek memakai TABEL BERJENJANG SK Pasal 3.2 (Tabel 1-6).
// Sumber: SK/WRG/Sales/001/V/2026, PDF kanonik `WRG_NPK_Sales_SK.pdf` (Drive
// fileId 1ZzLuQ93QQ80_Qhvd6VwmSfWuFjBKlHPn), dibaca & di-cross-check 2026-08-07.
//
// KENAPA FILE TERPISAH dari npk-calc.ts. npk-calc memberi skor LINIER
// ((aktual/target)×100, di-cap 120, ×bobot/100) — itu tafsiran PRD/ACE, bukan SK.
// Selisihnya nyata: Revenue 120% → linier 30 poin padahal maks SK 25; rasio AR>45
// sebesar 30% → linier 7 poin padahal SK Tabel 3 cuma 1.
//
// SEJAK v1.166.0 modul ini dipakai KEDUA jalur — AM (repo/npk-am.ts) dan HoD
// (repo/npk.ts) — jadi angka NPK AM & HoD sebanding lagi. calcNPK() linier tinggal
// jadi pembanding audit (scripts/ops/npk-compare-metode.mjs), tanpa pemanggil produksi.
//
// Perbedaan penting vs linier:
//   - Poin maksimum tiap aspek = BOBOTNYA (Revenue maks 25, AR maks 10, dst).
//     Tidak ada cap 120% — mekanisme itu tidak ada di SK.
//   - Total maksimum = 100, persis "NPK TOTAL (Maks = 100)" di Pasal 3.1.

import {
  ASPECT_LABEL, ASPECT_ORDER, DEFAULT_BOBOT,
  type AspectInput, type AspectKey, type AspectResult, type NPKResult,
} from "./npk-calc.js";
import { predikatOf } from "./npk-calc.js";

// Satu baris tabel SK: batas bawah (inklusif) → poin.
type Band = readonly [min: number, poin: number];

// Cari poin dari tabel menurun. KONVENSI BATAS: band SK ditulis tumpang-tindih
// ("100–110" dan "90–100" sama-sama memuat 100); di sini batas bawah selalu
// inklusif, jadi nilai persis 100 masuk band "100–110" (poin lebih tinggi).
const pick = (bands: readonly Band[], v: number, floor: number): number => {
  for (const [min, poin] of bands) if (v >= min) return poin;
  return floor;
};

// Tabel 1 — Revenue Achievement (maks 25), atas pencapaian %.
const T1_REVENUE: readonly Band[] = [
  [110, 25], [100, 22], [90, 20], [80, 18], [70, 16], [60, 14],
  [50, 12], [40, 10], [30, 8], [20, 6],
];
export const skRevenue = (pencapaianPct: number): number => pick(T1_REVENUE, pencapaianPct, 4);

// Tabel 2 — Customer Count Growth (maks 15), atas pencapaian %.
const T2_CUSTOMER: readonly Band[] = [
  [110, 15], [100, 13], [90, 11], [80, 9], [70, 7], [60, 5], [50, 3],
];
export const skCustomer = (pencapaianPct: number): number => pick(T2_CUSTOMER, pencapaianPct, 1);

// Tabel 3 — AR Aging (maks 10), atas rasio (AR>45 hari ÷ total AR) dalam %.
// Naik = makin buruk, jadi tabelnya dibaca dari batas ATAS.
export function skAr(rasioPct: number): number {
  if (rasioPct <= 2) return 10;
  if (rasioPct <= 5) return 9;
  if (rasioPct <= 10) return 8;
  if (rasioPct <= 15) return 7;
  if (rasioPct <= 20) return 5;
  if (rasioPct <= 25) return 3;
  return 1;
}

// Tabel 4 — KSO Penetration (maks 15), atas pencapaian %.
// Penalti −10 poin per KSO expire tanpa renewal yang tak dilaporkan ≤7 hari.
const T4_KSO: readonly Band[] = [
  [100, 15], [90, 12], [80, 10], [70, 8], [60, 6], [50, 4],
];
export const skKso = (pencapaianPct: number, expiredTanpaRenewal = 0): number =>
  Math.max(0, pick(T4_KSO, pencapaianPct, 2) - expiredTanpaRenewal * 10);

// Tabel 5 — GP Margin (maks 15), atas (GP aktual ÷ target GP) dalam %.
const T5_GP: readonly Band[] = [
  [115, 15], [105, 13], [100, 11], [90, 9], [80, 7], [70, 5],
];
export const skGp = (pencapaianPct: number): number => pick(T5_GP, pencapaianPct, 3);

// Tabel 6 — CRM Activity & Admin (maks 10), atas CRM Score 0-100.
const T6_CRM: readonly Band[] = [[90, 10], [80, 8], [70, 6], [60, 4]];
export const skCrm = (crmScore: number): number => pick(T6_CRM, crmScore, 2);

// CRM Score = (Call×10 + Area×10 + NewCust×10 + Timeliness) ÷ 4 (SK Tabel 6).
// Tiga yang pertama berskala 0-10, `timeliness` 0-100 — satu-satunya pembacaan
// yang menghasilkan 0-100. (Definisi sub-metrik di SK ditulis "× 100%", yang
// bertentangan dengan aritmetika ×10-nya; lihat catatan di repo/npk-am.ts.)
export const crmScore = (call: number, area: number, newCust: number, timeliness: number): number =>
  (call * 10 + area * 10 + newCust * 10 + timeliness) / 4;

// Aspek 7 — Competency & Coaching (bobot 10). SK tidak memberi tabel band untuk
// ini ("penilaian kualitatif HOD, skala 1-100") → tetap proporsional.
export const skCoaching = (skala0_100: number): number =>
  (Math.min(100, Math.max(0, skala0_100)) * DEFAULT_BOBOT.coaching) / 100;

const pctOf = (aktual: number, target: number): number => (target > 0 ? (aktual / target) * 100 : 0);

// Hitung NPK memakai tabel SK. Bentuk hasil sama dengan calcNPK() supaya bisa
// dipakai penyimpan & UI yang sudah ada, dengan pemetaan:
//   raw          = pencapaian mentah (%, atau rasio AR / CRM Score) — nilai audit
//   contribution = POIN SK (maks = bobot aspek)
//   capped       = poin dinormalkan ke 0-100 (poin ÷ bobot × 100) — supaya sel
//                  matrix & warna band di UI tetap berarti "skor aspek 0-100"
export function calcNpkSk(
  input: AspectInput,
  avail: Partial<Record<AspectKey, boolean>> = {},
): NPKResult {
  const revenuePct = pctOf(input.revenue_actual, input.revenue_target);
  const customerPct = pctOf(input.customer_active_count, input.customer_target);
  const arRasio = input.ar_total > 0 ? (input.ar_over_45d / input.ar_total) * 100 : 0;
  const ksoPct = pctOf(input.kso_active, input.kso_target);
  const gpPct = pctOf(input.gp_actual, input.gp_target);
  const crm = crmScore(input.call_coverage_pct, input.area_coverage_pct, input.new_cust_rate_pct, input.timeliness_pct);

  const raw: Record<AspectKey, number> = {
    revenue: revenuePct, customer: customerPct, ar: arRasio,
    kso: ksoPct, gp: gpPct, crm, coaching: input.coaching_score,
  };
  const poin: Record<AspectKey, number> = {
    revenue: skRevenue(revenuePct),
    customer: skCustomer(customerPct),
    ar: skAr(arRasio),
    kso: skKso(ksoPct, input.kso_expired_no_renewal),
    gp: skGp(gpPct),
    crm: skCrm(crm),
    coaching: skCoaching(input.coaching_score),
  };

  let npk = 0;
  let available_count = 0;
  const aspects: AspectResult[] = ASPECT_ORDER.map((key) => {
    const available = avail[key] !== false; // default true
    const bobot = DEFAULT_BOBOT[key];
    const contribution = available ? poin[key] : 0;
    if (available) available_count += 1;
    npk += contribution;
    // Aspek tanpa sumber data dinolkan SELURUHNYA, bukan cuma kontribusinya. Tabel
    // SK punya nilai DASAR untuk pencapaian 0 (KSO 2, GP 3, Revenue 4, …) — angka
    // itu berarti "capaian nol", bukan "belum diukur". Menyimpannya untuk aspek N/A
    // bikin audit & sel matrix seolah aspeknya pernah dinilai.
    return {
      key, label: ASPECT_LABEL[key], bobot,
      raw: available ? raw[key] : 0,
      capped: available && bobot > 0 ? (poin[key] / bobot) * 100 : 0,
      contribution,
      available,
    };
  });

  const npkRounded = Math.round(npk * 100) / 100;
  return { npk: npkRounded, predikat: predikatOf(npkRounded), aspects, available_count };
}
