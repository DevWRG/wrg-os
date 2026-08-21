// Tes tabel berjenjang SK Pasal 3.2 (Tabel 1-6). Angka acuan diambil LANGSUNG
// dari PDF SK kanonik — kalau tes ini merah, entah tabelnya salah ketik atau ada
// yang mengubah aturan tanpa revisi SK.
// Jalankan: node --test apps/api/dist/lib/npk-sk.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { calcNpkSk, crmScore, skAr, skCoaching, skCrm, skCustomer, skGp, skKso, skRevenue } from "./npk-sk.js";
import { DEFAULT_BOBOT, type AspectInput } from "./npk-calc.js";

const base: AspectInput = {
  revenue_actual: 0, revenue_target: 0,
  customer_active_count: 0, customer_target: 0,
  ar_over_45d: 0, ar_total: 0,
  kso_active: 0, kso_target: 0, kso_expired_no_renewal: 0,
  gp_actual: 0, gp_target: 0,
  call_coverage_pct: 0, area_coverage_pct: 0, new_cust_rate_pct: 0, timeliness_pct: 0,
  coaching_score: 0,
};

test("Tabel 1 Revenue — tiap band sesuai SK (maks 25)", () => {
  assert.equal(skRevenue(130), 25);
  assert.equal(skRevenue(110), 25);
  assert.equal(skRevenue(105), 22);
  assert.equal(skRevenue(95), 20);
  assert.equal(skRevenue(85), 18);
  assert.equal(skRevenue(75), 16);
  assert.equal(skRevenue(65), 14);
  assert.equal(skRevenue(55), 12);
  assert.equal(skRevenue(45), 10);
  assert.equal(skRevenue(35), 8);
  assert.equal(skRevenue(25), 6);
  assert.equal(skRevenue(10), 4);
  assert.equal(skRevenue(0), 4); // ≤20 → 4 (bukan 0) sesuai tabel
});

test("Tabel 2 Customer — maks 15, dasar 1", () => {
  assert.equal(skCustomer(120), 15);
  assert.equal(skCustomer(100), 13);
  assert.equal(skCustomer(90), 11);
  assert.equal(skCustomer(80), 9);
  assert.equal(skCustomer(70), 7);
  assert.equal(skCustomer(60), 5);
  assert.equal(skCustomer(50), 3);
  assert.equal(skCustomer(20), 1);
});

test("Tabel 3 AR — terbalik (rasio rendah = poin tinggi), maks 10", () => {
  assert.equal(skAr(0), 10);
  assert.equal(skAr(2), 10);
  assert.equal(skAr(4), 9);
  assert.equal(skAr(8), 8);
  assert.equal(skAr(12), 7);
  assert.equal(skAr(18), 5);
  assert.equal(skAr(23), 3);
  assert.equal(skAr(30), 1);
});

test("regresi: AR buruk TIDAK boleh selonggar skor linier", () => {
  // Inti kenapa modul ini ada. Rasio AR>45 = 30%:
  //   linier npk-calc → (100−30) × 10/100 = 7 poin
  //   SK Tabel 3      → 1 poin
  const linier = ((100 - 30) * DEFAULT_BOBOT.ar) / 100;
  assert.equal(linier, 7);
  assert.equal(skAr(30), 1);
});

test("Tabel 4 KSO — maks 15 + penalti −10 per expire tanpa renewal", () => {
  assert.equal(skKso(100), 15);
  assert.equal(skKso(95), 12);
  assert.equal(skKso(85), 10);
  assert.equal(skKso(75), 8);
  assert.equal(skKso(65), 6);
  assert.equal(skKso(55), 4);
  assert.equal(skKso(30), 2);
  assert.equal(skKso(100, 1), 5);   // 15 − 10
  assert.equal(skKso(100, 2), 0);   // tak boleh negatif
});

test("Tabel 5 GP — maks 15, dasar 3", () => {
  assert.equal(skGp(120), 15);
  assert.equal(skGp(110), 13);
  assert.equal(skGp(102), 11);
  assert.equal(skGp(95), 9);
  assert.equal(skGp(85), 7);
  assert.equal(skGp(75), 5);
  assert.equal(skGp(60), 3);
});

test("Tabel 6 CRM — band atas CRM Score, maks 10", () => {
  assert.equal(skCrm(95), 10);
  assert.equal(skCrm(85), 8);
  assert.equal(skCrm(75), 6);
  assert.equal(skCrm(65), 4);
  assert.equal(skCrm(40), 2);
});

test("CRM Score: contoh SK 8/7/6/80 → 72,5 → band 'Cukup' = 6 poin", () => {
  const s = crmScore(8, 7, 6, 80);
  assert.equal(s, 72.5);
  assert.equal(skCrm(s), 6);
});

test("Coaching tetap proporsional (SK tak memberi tabel band)", () => {
  assert.equal(skCoaching(100), 10);
  assert.equal(skCoaching(75), 7.5);
  assert.equal(skCoaching(0), 0);
});

test("poin maks tiap aspek = bobotnya, total maks 100 (Pasal 3.1)", () => {
  const sempurna: AspectInput = {
    ...base,
    revenue_actual: 120, revenue_target: 100,
    customer_active_count: 120, customer_target: 100,
    ar_over_45d: 0, ar_total: 1000,
    kso_active: 12, kso_target: 10,
    gp_actual: 120, gp_target: 100,
    call_coverage_pct: 10, area_coverage_pct: 10, new_cust_rate_pct: 10, timeliness_pct: 100,
    coaching_score: 100,
  };
  const r = calcNpkSk(sempurna);
  assert.equal(r.npk, 100); // TIDAK 120 — tak ada cap-120 di SK
  assert.equal(r.predikat, "sangat_baik");
  for (const a of r.aspects) assert.equal(a.contribution, DEFAULT_BOBOT[a.key]);
});

test("over-achieve tidak menembus plafon aspek (beda dari cap 120 linier)", () => {
  const r = calcNpkSk({ ...base, revenue_actual: 300, revenue_target: 100 },
    { customer: false, ar: false, kso: false, gp: false, crm: false, coaching: false });
  const rev = r.aspects.find((a) => a.key === "revenue")!;
  assert.equal(rev.contribution, 25);   // linier akan memberi 120 × 25/100 = 30
  assert.equal(rev.raw, 300);           // pencapaian mentah tetap terekam utk audit
  assert.equal(rev.capped, 100);        // normalisasi 0-100 utk UI
  assert.equal(r.npk, 25);
});

test("aspek tak tersedia → kontribusi 0 & tak dihitung coverage", () => {
  const r = calcNpkSk({ ...base, revenue_actual: 100, revenue_target: 100 },
    { customer: false, ar: false, kso: false, gp: false, crm: false, coaching: false });
  assert.equal(r.available_count, 1);
  assert.equal(r.npk, 22); // Revenue 100% → band 100-110 → 22 poin
});

test("aspek N/A dinolkan penuh — nilai DASAR tabel tidak ikut tersimpan", () => {
  // Tanpa ini, KSO tanpa data tersimpan 2 poin (dasar Tabel 4) dan GP 3 poin
  // (dasar Tabel 5) → audit seolah aspeknya pernah diukur.
  const r = calcNpkSk(base, { revenue: false, customer: false, ar: false, kso: false, gp: false, crm: false, coaching: false });
  assert.equal(r.npk, 0);
  assert.equal(r.available_count, 0);
  for (const a of r.aspects) {
    assert.equal(a.raw, 0, `${a.key} raw`);
    assert.equal(a.capped, 0, `${a.key} capped`);
    assert.equal(a.contribution, 0, `${a.key} contribution`);
  }
});

test("AR tanpa tagihan sama sekali → rasio 0 → poin penuh", () => {
  const r = calcNpkSk({ ...base, ar_total: 0, ar_over_45d: 0 },
    { revenue: false, customer: false, kso: false, gp: false, crm: false, coaching: false });
  assert.equal(r.npk, 10);
});
