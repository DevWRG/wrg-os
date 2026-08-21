// Unit test validasi tahun — regresi dari 37 baris sales_plan bertahun ngawur
// (0202 / 2025 / 2027 / 2028 / 2029) yang tersimpan Juli–Agustus 2026. Jalankan:
//   pnpm --filter @wrg/api exec node --import tsx --test src/parsers/tanggal.test.ts
//
// Semua kasus di bawah diambil dari pesan WA nyata; waktu dipancang lewat nowMs
// supaya tes tidak lapuk seiring berjalannya waktu.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIso, expandYear, plausibleIso } from "./tanggal.js";
import { parseAmPlan } from "./am.js";
import { parseDaily } from "./dailyplan.js";

// 2026-08-10 12:00 WIB
const NOW = Date.parse("2026-08-10T05:00:00Z");

test("expandYear: 2 digit → 20xx, 4 digit apa adanya, 1/3 digit ditolak", () => {
  assert.equal(expandYear("26"), 2026); // dipakai 201 pesan nyata
  assert.equal(expandYear("06"), 2006);
  assert.equal(expandYear("2026"), 2026);
  assert.equal(expandYear("202"), null); // AM kehilangan digit → dulu jadi tahun 202
  assert.equal(expandYear("2"), null);
  assert.equal(expandYear("20261"), null);
});

test("plausibleIso: batas 180 hari dua arah", () => {
  assert.equal(plausibleIso("2026-08-10", NOW), true);
  assert.equal(plausibleIso("2026-06-01", NOW), true);
  assert.equal(plausibleIso("2025-07-24", NOW), false); // kasus Iqbal
  assert.equal(plausibleIso("2027-08-01", NOW), false); // kasus Vicky
});

test("buildIso: tahun 2 digit wajar tetap dihormati", () => {
  assert.equal(buildIso(7, 8, "26", NOW), "2026-08-07"); // "07/8/26" — Munir, Joni
  assert.equal(buildIso(10, 8, undefined, NOW), "2026-08-10"); // tanpa tahun
});

test("buildIso: tahun ngawur dipaksa ke tahun sekarang, hari & bulan dipertahankan", () => {
  assert.equal(buildIso(23, 7, "202", NOW), "2026-07-23"); // 0202-07-22 di DB
  assert.equal(buildIso(16, 7, "29", NOW), "2026-07-16"); // 2029-07-16 di DB
  assert.equal(buildIso(1, 8, "2027", NOW), "2026-08-01"); // 2027-08-01 di DB
  assert.equal(buildIso(29, 7, "2028", NOW), "2026-07-29"); // 2028-07-29 di DB
  assert.equal(buildIso(24, 7, "2025", NOW), "2026-07-24"); // 2025-07-24 di DB
});

test("buildIso: hari/bulan tidak valid → null", () => {
  assert.equal(buildIso(32, 7, "2026", NOW), null);
  assert.equal(buildIso(10, 13, "2026", NOW), null);
});

test("buildIso: tanggal wajar tapi tahun sekarang juga tak menolong → null", () => {
  // 5 Januari: dari 10 Agustus jaraknya 217 hari, dan memaksa tahun sekarang
  // menghasilkan tanggal yang sama → tidak ada yang bisa diselamatkan.
  assert.equal(buildIso(5, 1, "2026", NOW), null);
  // 25 Februari masih 166 hari → di dalam jendela, jadi tetap diterima.
  assert.equal(buildIso(25, 2, "2026", NOW), "2026-02-25");
});

test("regresi #PLAN Vicky: 3 digit tahun tidak lagi jadi tahun 202", () => {
  const r = parseAmPlan("#Plan Vicky 23/07/202\n1. Labkesda Provinsi NTB | Visit | menemui dokter", NOW);
  assert.equal(r.tanggal, "2026-07-23");
});

test("regresi #PLAN Irul: 2 digit tahun salah ketik tidak lagi jadi 2029", () => {
  const r = parseAmPlan("#Plan 16/7/29\n1. rsud setijono | visit | survey KSO lab", NOW);
  assert.equal(r.tanggal, "2026-07-16");
});

test("regresi #PLAN Sidqi: 4 digit tahun salah ketik tidak lagi jadi 2028", () => {
  const r = parseAmPlan("#PLAN 29/07/2028\n1. RSUD Ibu Fatmawati | Visit | menemui dr. Ellya", NOW);
  assert.equal(r.tanggal, "2026-07-29");
});

test("regresi daily #plan: tahun 2 digit wajar tetap lolos", () => {
  const r = parseDaily("#plan joni\n7/8/26\n\n1.siapkan kiriman\n2.croscek bs", NOW);
  assert.equal(r?.tanggal, "2026-08-07");
});

// ── Jaring masa depan (asimetris) ────────────────────────────────────────────
// Jaring lama simetris ±180 hari, jadi tanggal masa depan yang "dekat" lolos dan
// barisnya duduk di masa depan tanpa pernah cocok ke plan. Kejadian nyata: 6
// baris activity_log am 18 bertanggal 2027-07-27 dari pesan 2026-07-27.
// Batas +7 diambil dari data produksi: sales_plan NOL baris masa depan,
// sales_todo hanya 5 baris di +1.

test("plausibleIso: asimetris — 180 hari ke belakang, hanya 7 ke depan", () => {
  assert.equal(plausibleIso("2026-08-03", NOW), true); // -7
  assert.equal(plausibleIso("2026-03-01", NOW), true); // ~-162, backdate sah
  assert.equal(plausibleIso("2026-02-11", NOW), true); // -180 batas lampau
  assert.equal(plausibleIso("2026-02-10", NOW), false); // -181 → ditolak
  assert.equal(plausibleIso("2026-08-11", NOW), true); // +1, plan besok
  assert.equal(plausibleIso("2026-08-17", NOW), true); // +7 batas depan
  assert.equal(plausibleIso("2026-08-18", NOW), false); // +8 → ditolak
  assert.equal(plausibleIso("2026-09-10", NOW), false); // +31 → ditolak
  assert.equal(plausibleIso("2025-08-10", NOW), false); // -365 → tetap ditolak
});

test("plan besok (+1) tetap diterima — 5 baris sales_todo nyata memakainya", () => {
  const r = parseDaily("#plan joni\n11/8/26\n\n1.kirim sampel", NOW);
  assert.equal(r?.tanggal, "2026-08-11");
});

test("#REPORT bertanggal sebulan ke depan tidak lagi disimpan di masa depan", () => {
  // 10/9/26 dari pesan 10 Agu = +31 hari. Tahun sudah benar, jadi retry
  // tahun-berjalan menghasilkan tanggal yang sama → null → caller pakai hari ini.
  assert.equal(buildIso(10, 9, "26", NOW), null);
});

test("regresi Yugo: 27/7/27 dari pesan 27 Jul 2026 → 2026, bukan 2027", () => {
  // Pesan asli AC8AD824… masuk 2026-07-27 20:35 WIB, sebelum validasi tahun ada.
  const saatItu = Date.parse("2026-07-27T13:35:00Z");
  assert.equal(buildIso(27, 7, "27", saatItu), "2026-07-27");
});

test("batas +7 tidak menggeser tanggal hari ini", () => {
  assert.equal(buildIso(10, 8, "26", NOW), "2026-08-10");
});
