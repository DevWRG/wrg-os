// F66 NPK Engine — fungsi murni perhitungan NPK (Nilai Prestasi Karyawan).
// Kanonik: SK/WRG/Sales/001/V/2026 Pasal 3.1 (7 aspek berbobot) + Pasal 3.5 (contoh).
// TANPA akses DB — input mentah dikumpulkan repo/npk.ts, fungsi ini hanya menghitung
// (mudah di-unit-test; reproduksi contoh SK = AC-1). Tiap aspek di-cap 0..120 lalu
// ×bobot/100. NPK = Σ kontribusi aspek (0-100 bila semua aspek 100 & bobot Σ=100).
//
// Kejujuran data: `avail` menandai aspek yang BELUM punya sumber data live (KSO/GP/
// coaching/target dst). Aspek tak-tersedia → kontribusi DIPAKSA 0 (tak menggelembungkan
// NPK). Bila semua aspek tersedia (kasus uji SK), hasil = formula PRD §4 persis.

export type AspectKey = "revenue" | "customer" | "ar" | "kso" | "gp" | "crm" | "coaching";

export const ASPECT_ORDER: AspectKey[] = ["revenue", "customer", "ar", "kso", "gp", "crm", "coaching"];

export const ASPECT_LABEL: Record<AspectKey, string> = {
  revenue: "Revenue Achievement",
  customer: "Customer Count Growth",
  ar: "AR Aging",
  kso: "KSO Penetration",
  gp: "GP Margin",
  crm: "CRM/Presales Activity",
  coaching: "Competency & Coaching",
};

export interface NPKBobot {
  revenue: number; customer: number; ar: number; kso: number; gp: number; crm: number; coaching: number;
}

// Bobot default SK Pasal 3.1 (Σ = 100). Rekalibrasi ≥1×/tahun (Pasal 9.2) via config (menyusul).
export const DEFAULT_BOBOT: NPKBobot = {
  revenue: 25, customer: 15, ar: 10, kso: 15, gp: 15, crm: 10, coaching: 10,
};

export interface AspectInput {
  revenue_actual: number;
  revenue_target: number;
  customer_active_count: number;
  customer_target: number;
  ar_over_45d: number;
  ar_total: number;
  kso_active: number;
  kso_target: number;
  kso_expired_no_renewal: number;
  gp_actual: number;
  gp_target: number;
  call_coverage_pct: number;   // 0-100
  area_coverage_pct: number;   // 0-100
  new_cust_rate_pct: number;   // 0-100
  timeliness_pct: number;      // 0-100 (% input aktivitas ≤48h)
  coaching_score: number;      // 0-100 (input manual HoD)
}

export type NPKPredikat = "sangat_baik" | "baik" | "cukup" | "kurang" | "buruk";

export interface AspectResult {
  key: AspectKey;
  label: string;
  bobot: number;
  raw: number;        // skor mentah (bisa >100)
  capped: number;     // di-cap 0..120
  contribution: number; // capped × bobot / 100 (0 bila !available)
  available: boolean;
}

export interface NPKResult {
  npk: number;        // 0-100 (2 desimal)
  predikat: NPKPredikat;
  aspects: AspectResult[];
  available_count: number; // berapa dari 7 aspek punya sumber data
}

const cap120 = (v: number): number => Math.min(120, Math.max(0, v));

export function predikatOf(score: number): NPKPredikat {
  if (score >= 90) return "sangat_baik";
  if (score >= 75) return "baik";
  if (score >= 60) return "cukup";
  if (score >= 50) return "kurang";
  return "buruk";
}

// Hitung skor MENTAH per aspek sesuai SK Pasal 3 (sebelum cap & bobot).
function rawScores(input: AspectInput): Record<AspectKey, number> {
  // 1. Revenue Achievement
  const revenue = input.revenue_target > 0 ? (input.revenue_actual / input.revenue_target) * 100 : 0;
  // 2. Customer Count Growth
  const customer = input.customer_target > 0 ? (input.customer_active_count / input.customer_target) * 100 : 0;
  // 3. AR Aging (RENDAH = BAIK, inverted). Tanpa AR → 100 (tak ada tunggakan).
  const arRatio = input.ar_total > 0 ? (input.ar_over_45d / input.ar_total) * 100 : 0;
  const ar = 100 - arRatio;
  // 4. KSO Penetration + penalti −10 per KSO expire tanpa renewal
  const ksoBase = input.kso_target > 0 ? (input.kso_active / input.kso_target) * 100 : 0;
  const kso = ksoBase - input.kso_expired_no_renewal * 10;
  // 5. GP Margin
  const gp = input.gp_target > 0 ? (input.gp_actual / input.gp_target) * 100 : 0;
  // 6. CRM/Presales Activity (composite, per PRD §4)
  const crm =
    (input.call_coverage_pct * 10 + input.area_coverage_pct * 10 + input.new_cust_rate_pct * 10 + input.timeliness_pct) / 4;
  // 7. Competency & Coaching (manual HoD)
  const coaching = input.coaching_score;
  return { revenue, customer, ar, kso, gp, crm, coaching };
}

// Hitung NPK. `avail` menandai aspek yang punya sumber data live (default: semua true —
// dipakai unit test SK). Aspek !available → kontribusi 0 (NPK tak menggelembung).
export function calcNPK(
  input: AspectInput,
  bobot: NPKBobot = DEFAULT_BOBOT,
  avail: Partial<Record<AspectKey, boolean>> = {},
): NPKResult {
  const raws = rawScores(input);
  let npk = 0;
  let available_count = 0;
  const aspects: AspectResult[] = ASPECT_ORDER.map((key) => {
    const available = avail[key] !== false; // default true
    const raw = raws[key];
    const capped = cap120(raw);
    const contribution = available ? (capped * bobot[key]) / 100 : 0;
    if (available) available_count += 1;
    npk += contribution;
    return { key, label: ASPECT_LABEL[key], bobot: bobot[key], raw, capped, contribution, available };
  });
  const npkRounded = Math.round(npk * 100) / 100;
  return { npk: npkRounded, predikat: predikatOf(npkRounded), aspects, available_count };
}
