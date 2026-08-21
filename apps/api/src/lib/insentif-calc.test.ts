// Unit test F67 Insentif Engine. Jalankan:
//   pnpm --filter @wrg/api exec node --import tsx --test src/lib/insentif-calc.test.ts
//
// Fixture utama diturunkan dari model kanonik `wrg_incentive_console_v2.jsx`
// (PRD-S3-Insentif-Simulator-v2.md v3.0 §A.2). Angka harapan dihitung tangan —
// kalau meleset, yang salah rumusnya, bukan fixture-nya.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeTransaksi, rekapBulanan, marginReward, collectionFactor,
  HARGA_POIN, type TrxInput,
} from "./insentif-calc.js";

const base: TrxInput = {
  revenue: 100_000_000,
  tier: "P2",            // harga poin 98
  gpActualPct: 40,
  gpTargetPct: 30,
  isKso: false,
  isEcatPl: false,
  agingDays: 25,
  ncrType: "newMurni",
  leadType: "A",
  effort: 82,
  presales: 5,
};

// ── Fixture utama ──
// PI      = 100.000.000 × 0,000064            = 6.400 poin
// MR      = (40 − 30) × 2,5                   = 25
// NCR     = baru murni                        = 30
// CF      = aging 25 hari                     = 1,00
// pengali = (1 + 0,25 + 0,30) × 1,00 × 0,87   = 1,3485
// raw     = 6.400 × 98 × 1,3485               = 845.779,2 → 845.779
test("fixture kanonik: AM P2, revenue 100jt, GP 40 vs 30, aging 25, baru murni, lead A", () => {
  const r = computeTransaksi(base);
  assert.equal(r.piPoints, 6400);
  assert.equal(r.hargaPoin, 98);
  assert.equal(r.mrPct, 25);
  assert.equal(r.ncrPct, 30);
  assert.equal(r.cf, 1.0);
  assert.ok(Math.abs(r.pengali - 1.3485) < 1e-9, `pengali ${r.pengali}`);
  assert.equal(r.insentifAm, 845_779);
  assert.equal(r.insentifHo, 0);
});

// ── Bagi hasil lead: yang tidak jatuh ke AM WAJIB masuk HO Pool, tanpa bocor ──
test("lead B: AM 30%, sisanya ke HO Pool", () => {
  const r = computeTransaksi({ ...base, leadType: "B" });
  assert.equal(r.insentifAm, 253_734);
  assert.equal(r.insentifHo, 592_045);
});

test("lead C: AM 15%, sisanya ke HO Pool", () => {
  const r = computeTransaksi({ ...base, leadType: "C" });
  assert.equal(r.insentifAm, 126_867);
  assert.equal(r.insentifHo, 718_912);
});

test("AM + HO tidak pernah lebih besar dari raw (pembulatan tak boleh menciptakan uang)", () => {
  for (const leadType of ["A", "B", "C"] as const) {
    const r = computeTransaksi({ ...base, leadType });
    assert.ok(r.insentifAm + r.insentifHo <= r.insentifRaw + 1, `lead ${leadType}`);
  }
});

// ── MR ──
test("KSO memaksa MR 0 walau GP tinggi", () => {
  const r = computeTransaksi({ ...base, isKso: true });
  assert.equal(r.mrPct, 0);
  assert.equal(r.insentifAm, 709_363);
});

test("ECAT/Price List memaksa MR 0 (harga fixed)", () => {
  assert.equal(computeTransaksi({ ...base, isEcatPl: true }).mrPct, 0);
});

test("MR ter-clamp di 35 walau selisih GP besar", () => {
  // (60 − 30) × 2,5 = 75 → dibatasi 35
  assert.equal(marginReward(60, 30, false, false), 35);
});

test("MR tidak pernah negatif saat GP di bawah target", () => {
  assert.equal(marginReward(20, 30, false, false), 0);
  assert.equal(marginReward(30, 30, false, false), 0);
});

test("gpActualPct null (HPP SKU belum ada) → MR 0, bukan NaN", () => {
  const r = computeTransaksi({ ...base, gpActualPct: null });
  assert.equal(r.mrPct, 0);
  assert.ok(Number.isFinite(r.insentifAm));
});

// ── CF: diuji TEPAT DI BATAS, karena tabelnya pakai ≤ ──
test("CF tepat di batas tiap tingkat", () => {
  assert.equal(collectionFactor(10), 1.05);
  assert.equal(collectionFactor(11), 1.0);
  assert.equal(collectionFactor(30), 1.0);
  assert.equal(collectionFactor(31), 0.9);
  assert.equal(collectionFactor(60), 0.9);
  assert.equal(collectionFactor(61), 0.75);
  assert.equal(collectionFactor(90), 0.75);
  assert.equal(collectionFactor(91), 0.5);
});

test("aging 95 hari memotong setengah", () => {
  const r = computeTransaksi({ ...base, agingDays: 95 });
  assert.equal(r.cf, 0.5);
  assert.equal(r.insentifAm, 422_890);
});

// ── NCR ──
test("NCR: reaktivasi 20, existing 0, baru murni 30", () => {
  assert.equal(computeTransaksi({ ...base, ncrType: "reaktivasi" }).ncrPct, 20);
  assert.equal(computeTransaksi({ ...base, ncrType: "existing" }).ncrPct, 0);
  assert.equal(computeTransaksi({ ...base, ncrType: "newMurni" }).ncrPct, 30);
});

// ── Harga poin per tier ──
test("tier menaikkan insentif secara proporsional", () => {
  const p0 = computeTransaksi({ ...base, tier: "P0" }).insentifAm;
  const p3 = computeTransaksi({ ...base, tier: "P3" }).insentifAm;
  assert.ok(p3 > p0);
  // Rasio harus persis rasio harga poinnya (103 / 90), karena sisa rumus identik.
  assert.ok(Math.abs(p3 / p0 - HARGA_POIN.P3 / HARGA_POIN.P0) < 1e-3);
});

test("tier tak dikenal → harga poin 0, bukan crash", () => {
  const r = computeTransaksi({ ...base, tier: "TIDAK-ADA" as never });
  assert.equal(r.insentifAm, 0);
});

// ── Pengali maksimum: SENGAJA tidak di-cap ke 1,75 ──
test("pengali maksimum ±1,906 — tidak di-cap ke 1,75 seperti klaim di berkas sumber", () => {
  const r = computeTransaksi({
    ...base, gpActualPct: 100, ncrType: "newMurni", agingDays: 5, effort: 100, presales: 10,
  });
  assert.equal(r.mrPct, 35);
  assert.ok(Math.abs(r.pengali - 1.90575) < 1e-5, `pengali ${r.pengali}`);
  assert.ok(r.pengali > 1.75, "kalau ini gagal, ada yang memasang cap diam-diam");
});

// ── Rekap bulanan + batas ──
test("rekap di bawah batas: dibayar penuh, retention pool kosong", () => {
  const trx = [computeTransaksi(base), computeTransaksi(base)];
  const r = rekapBulanan(trx, 11_000_000);
  assert.equal(r.totalAm, 845_779 * 2);
  assert.equal(r.dibayar, 845_779 * 2);
  assert.equal(r.retentionPool, 0);
});

test("rekap di atas batas: dibayar = batas, kelebihan ke retention pool", () => {
  const trx = Array.from({ length: 20 }, () => computeTransaksi(base));
  const r = rekapBulanan(trx, 11_000_000);
  assert.equal(r.totalAm, 845_779 * 20); // 16.915.580
  assert.equal(r.dibayar, 11_000_000);
  assert.equal(r.retentionPool, 845_779 * 20 - 11_000_000);
  // Tidak ada rupiah yang hilang: yang dibayar + yang ditahan = total hak AM.
  assert.equal(r.dibayar + r.retentionPool, r.totalAm);
});

test("HO Pool ikut terakumulasi di rekap", () => {
  const trx = [computeTransaksi({ ...base, leadType: "B" })];
  const r = rekapBulanan(trx, 11_000_000);
  assert.equal(r.totalHo, 592_045);
});
