import assert from "node:assert/strict";
import { test } from "node:test";

import { HOT_MAX_DAYS, WARM_MAX_DAYS, frekuensiTurun, jendelaKso, kelasHealth, statusKso } from "./customer-health.js";

test("HOT = order ≤30 hari dan frekuensi tidak turun", () => {
  assert.equal(kelasHealth({ daysSince: 5, recent90: 4, prior90: 3 }).kelas, "HOT");
  assert.equal(kelasHealth({ daysSince: HOT_MAX_DAYS, recent90: 2, prior90: 2 }).kelas, "HOT");
});

test("baru order tapi frekuensi turun >50% = WARM, dan alasannya menyebut turun", () => {
  const h = kelasHealth({ daysSince: 10, recent90: 1, prior90: 4 });
  assert.equal(h.kelas, "WARM");
  assert.match(h.alasan, /frekuensi turun/);
});

test("penurunan kecil TIDAK menjatuhkan HOT (kasus nyata RSUD Perfect Rutin 17 vs 19)", () => {
  assert.equal(kelasHealth({ daysSince: 26, recent90: 17, prior90: 19 }).kelas, "HOT");
  assert.equal(kelasHealth({ daysSince: 3, recent90: 50, prior90: 62 }).kelas, "HOT");
});

test("frekuensiTurun = definisi risk F77: baseline ≥2 dan turun di bawah separuh", () => {
  assert.equal(frekuensiTurun(1, 4), true);
  assert.equal(frekuensiTurun(2, 4), false); // tepat separuh belum turun
  assert.equal(frekuensiTurun(0, 1), false); // baseline 1 faktur terlalu kecil untuk disebut tren
});

test("31–60 hari = WARM; lewat 60 hari = COLD (ambang sama dengan churn WatchPoint/F77)", () => {
  assert.equal(kelasHealth({ daysSince: 31, recent90: 9, prior90: 0 }).kelas, "WARM");
  assert.equal(kelasHealth({ daysSince: WARM_MAX_DAYS, recent90: 1, prior90: 1 }).kelas, "WARM");
  assert.equal(WARM_MAX_DAYS, 60);
  const c = kelasHealth({ daysSince: 61, recent90: 0, prior90: 2 });
  assert.equal(c.kelas, "COLD");
  assert.match(c.alasan, /tidak order 61 hari/);
});

test("belum pernah ada faktur = COLD", () => {
  assert.deepEqual(kelasHealth({ daysSince: null, recent90: 0, prior90: 0 }), { kelas: "COLD", alasan: "belum ada faktur" });
});

test("jendela KSO = bulan tutup tahun berjalan, bulan berjalan tidak dihitung", () => {
  assert.deepEqual(jendelaKso("2026-10-11"), { mulai: "2026-01-01", akhir: "2026-10-01", bulanTutup: 9, labelPeriode: "2026" });
  assert.deepEqual(jendelaKso("2026-02-28"), { mulai: "2026-01-01", akhir: "2026-02-01", bulanTutup: 1, labelPeriode: "2026" });
});

test("Januari belum punya bulan tutup → 3 bulan tutup terakhir tahun lalu", () => {
  assert.deepEqual(jendelaKso("2027-01-15"), { mulai: "2026-10-01", akhir: "2027-01-01", bulanTutup: 3, labelPeriode: "3 bln terakhir" });
});

test("status KSO: Perfect Rutin / Sesekali / Tidak beli; akun tanpa KSO = null", () => {
  const j = jendelaKso("2026-10-11");
  assert.equal(statusKso(false, 9, j), null);
  assert.equal(statusKso(true, 9, j)?.status, "PERFECT_RUTIN");
  assert.equal(statusKso(true, 9, j)?.label, "Perfect Rutin");
  assert.equal(statusKso(true, 5, j)?.status, "SESEKALI");
  assert.match(statusKso(true, 5, j)?.alasan ?? "", /5\/9 bulan/);
  const t = statusKso(true, 0, j);
  assert.equal(t?.status, "TIDAK_BELI");
  assert.equal(t?.label, "Tidak beli 2026");
  assert.equal(statusKso(true, 0, jendelaKso("2027-01-15"))?.label, "Tidak beli 3 bln terakhir");
});
