// Unit test F66 NPK Engine (AC-1..AC-4). Jalankan:
//   pnpm --filter @wrg/api exec node --import tsx --test src/lib/npk-calc.test.ts
// Contoh SK Pasal 3.5 literal butuh dok SK (tak ada di PRD) → di sini dipakai contoh
// terhitung-tangan yang memvalidasi tiap mekanik formula PRD §4.

import { test } from "node:test";
import assert from "node:assert/strict";

import { calcNPK, predikatOf, DEFAULT_BOBOT, type AspectInput } from "./npk-calc.js";

const base: AspectInput = {
  revenue_actual: 0, revenue_target: 0,
  customer_active_count: 0, customer_target: 0,
  ar_over_45d: 0, ar_total: 0,
  kso_active: 0, kso_target: 0, kso_expired_no_renewal: 0,
  gp_actual: 0, gp_target: 0,
  call_coverage_pct: 0, area_coverage_pct: 0, new_cust_rate_pct: 0, timeliness_pct: 0,
  coaching_score: 0,
};

// Contoh lengkap (semua aspek tersedia) — dihitung tangan → NPK 90.00 (sangat_baik).
const worked: AspectInput = {
  revenue_actual: 1200, revenue_target: 1000,           // raw120 → cap120 → 30.0
  customer_active_count: 90, customer_target: 100,      // raw90  → 13.5
  ar_over_45d: 10, ar_total: 100,                       // 100-10=90 → 9.0
  kso_active: 8, kso_target: 10, kso_expired_no_renewal: 1, // 80-10=70 → 10.5
  gp_actual: 75, gp_target: 100,                        // raw75 → 11.25
  call_coverage_pct: 8, area_coverage_pct: 7, new_cust_rate_pct: 6, timeliness_pct: 80, // (80+70+60+80)/4=72.5 → 7.25
  coaching_score: 85,                                   // 85 → 8.5
};

test("AC-1: contoh lengkap → NPK 90.00 sangat_baik (Σ kontribusi = formula PRD §4)", () => {
  const r = calcNPK(worked);
  assert.equal(r.npk, 90);
  assert.equal(r.predikat, "sangat_baik");
  assert.equal(r.available_count, 7);
  const by = Object.fromEntries(r.aspects.map((a) => [a.key, a]));
  assert.equal(by.revenue.contribution, 30);
  assert.equal(by.customer.contribution, 13.5);
  assert.equal(by.ar.contribution, 9);
  assert.equal(by.kso.contribution, 10.5);
  assert.equal(by.gp.contribution, 11.25);
  assert.equal(by.crm.contribution, 7.25);
  assert.equal(by.coaching.contribution, 8.5);
});

test("cap 120%: over-achieve revenue di-cap 120 (bukan >120)", () => {
  const r = calcNPK({ ...base, revenue_actual: 3000, revenue_target: 1000 });
  const rev = r.aspects.find((a) => a.key === "revenue")!;
  assert.equal(rev.raw, 300);
  assert.equal(rev.capped, 120);
  assert.equal(rev.contribution, 30); // 120 × 25 / 100
});

test("AC-4: AR Aging inverted — makin sedikit AR>45 makin tinggi skor", () => {
  const lo = calcNPK({ ...base, ar_over_45d: 5, ar_total: 100 }).aspects.find((a) => a.key === "ar")!;
  const hi = calcNPK({ ...base, ar_over_45d: 60, ar_total: 100 }).aspects.find((a) => a.key === "ar")!;
  assert.equal(lo.raw, 95);
  assert.equal(hi.raw, 40);
  assert.ok(lo.raw > hi.raw);
});

test("AC-5: KSO penalti −10 per expired tanpa renewal", () => {
  const a = calcNPK({ ...base, kso_active: 10, kso_target: 10, kso_expired_no_renewal: 2 }).aspects.find((x) => x.key === "kso")!;
  assert.equal(a.raw, 80); // 100 − 20
});

test("target 0 → aspek raw 0 (hindari div-by-zero)", () => {
  const rev = calcNPK({ ...base, revenue_actual: 500, revenue_target: 0 }).aspects.find((a) => a.key === "revenue")!;
  assert.equal(rev.raw, 0);
});

test("availability: aspek tak-tersedia → kontribusi 0 & tak dihitung available_count", () => {
  const r = calcNPK(worked, DEFAULT_BOBOT, { coaching: false, kso: false });
  const by = Object.fromEntries(r.aspects.map((a) => [a.key, a]));
  assert.equal(by.coaching.contribution, 0);
  assert.equal(by.kso.contribution, 0);
  assert.equal(by.coaching.available, false);
  assert.equal(r.available_count, 5);
  assert.equal(r.npk, 90 - 10.5 - 8.5); // 71.0
});

test("AC-3: threshold predikat 90/75/60/50", () => {
  assert.equal(predikatOf(90), "sangat_baik");
  assert.equal(predikatOf(89.99), "baik");
  assert.equal(predikatOf(75), "baik");
  assert.equal(predikatOf(74.9), "cukup");
  assert.equal(predikatOf(60), "cukup");
  assert.equal(predikatOf(59), "kurang");
  assert.equal(predikatOf(50), "kurang");
  assert.equal(predikatOf(49.9), "buruk");
  assert.equal(predikatOf(0), "buruk");
});
