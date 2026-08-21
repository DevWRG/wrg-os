// F66 NPK — tipe, konstanta, dan helper bersama perhitungan NPK (TANPA akses DB).
//
// ⚠️ PENSKORAN KANONIK ADA DI `npk-sk.ts` (tabel berjenjang SK Pasal 3.2), BUKAN di
// sini. `calcNPK()` di file ini = metode LINIER lama (rasio × bobot, di-cap 120%)
// yang dipakai sampai v1.165.x; itu tafsiran PRD/ACE, bukan bunyi SK — cap 120%
// bahkan tidak ada di SK dan bikin skor bisa melewati poin maks aspek. Sejak
// v1.166.0 jalur HoD MAUPUN AM memakai npk-sk.ts.
//
// calcNPK() SENGAJA dipertahankan (tanpa pemanggil produksi) sebagai pembanding
// audit: scripts/ops/npk-compare-metode.mjs memakainya untuk memperlihatkan
// pergeseran skor lama→baru sebelum recompute prod. Boleh dihapus setelah semua
// baris npk_score_semester & npk_am_score_semester di-compute ulang dengan SK.
//
// Yang MASIH dipakai luas dari file ini: AspectInput/AspectKey/AspectResult,
// ASPECT_ORDER, ASPECT_LABEL, DEFAULT_BOBOT (bobot SK Pasal 3.1 — sudah benar; yang
// keliru justru PRD v2 §D.1), predikatOf(), elapsedFraction(), ageCutoff().
//
// Kejujuran data: `avail` menandai aspek yang BELUM punya sumber data live (KSO/GP/
// coaching/target dst). Aspek tak-tersedia → kontribusi DIPAKSA 0 (tak menggelembungkan NPK).

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

const DAY_MS = 86400000;
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Fraksi periode yang sudah berjalan pada `now` (0..1), granularitas hari.
// Kenapa perlu: `revenue_target` semester dibandingkan dengan actual SAMPAI HARI INI.
// Tanpa pro-rata, semester yang baru jalan 3 minggu selalu terlihat gagal (HoD tepat
// sesuai pace pun cuma dapat raw ~10). Pola sama dipakai targetPacing (repo/sales.ts).
// Periode yang sudah lewat → 1, jadi skor historis tidak berubah.
export function elapsedFraction(from: string, to: string, now: Date): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!(end > start)) return 1;
  const total = (end - start) / DAY_MS + 1;             // inklusif hari terakhir
  const done = (utcDay(now) - start) / DAY_MS + 1;      // inklusif hari ini
  return Math.min(1, Math.max(0, done / total));
}

// Tanggal cutoff "umur > `days` hari", di-anchor ke HARI INI (dibatasi akhir periode).
// Kenapa perlu: anchor ke akhir periode bikin cutoff jatuh di MASA DEPAN untuk semester
// berjalan (S2 → 2026-11-16), sehingga semua invoice terhitung lewat jatuh tempo dan
// skor AR selalu 0. Untuk periode yang sudah lewat, anchor = akhir periode (tak berubah).
export function ageCutoff(to: string, now: Date, days = 45): string {
  const anchor = Math.min(utcDay(now), Date.parse(`${to}T00:00:00Z`));
  return new Date(anchor - days * DAY_MS).toISOString().slice(0, 10);
}

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

// METODE LINIER LAMA — PENSIUN sejak v1.166.0, jangan dipakai men-skor.
// Dipertahankan hanya sebagai pembanding audit (lihat catatan kepala file).
// Untuk penskoran, pakai calcNpkSk() di npk-sk.ts.
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
