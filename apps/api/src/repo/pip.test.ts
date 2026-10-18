import { test } from "node:test";
import assert from "node:assert/strict";

import { PipError, addDays, buildSeries, daysLeft, isIsoDate, parseGoal, parseMilestone, parseOutcome, parsePeriods, recentQuarters, weekNo } from "./pip.js";

// F70 — logika murni PIP tracker.

test("addDays: 90 hari lintas bulan/tahun, tanpa efek zona waktu", () => {
  assert.equal(addDays("2026-10-18", 90), "2027-01-16");
  assert.equal(addDays("2026-02-01", 0), "2026-02-01");
});

test("isIsoDate menolak tanggal mustahil", () => {
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-2-3"), false);
  assert.equal(isIsoDate(20260101), false);
  assert.equal(isIsoDate("2026-13-01"), false); // bulan mustahil: dulu melempar RangeError (500)
  assert.equal(isIsoDate("2026-00-10"), false);
  assert.equal(isIsoDate("2026-12-00"), false);
  assert.equal(isIsoDate("2026-12-31"), true);
});

test("weekNo: hari 0–6 = minggu 1, hari 7 = minggu 2, sebelum mulai = 0", () => {
  assert.equal(weekNo("2026-10-01", "2026-10-01"), 1);
  assert.equal(weekNo("2026-10-01", "2026-10-07"), 1);
  assert.equal(weekNo("2026-10-01", "2026-10-08"), 2);
  assert.equal(weekNo("2026-10-01", "2026-09-30"), 0);
});

test("daysLeft negatif bila lewat", () => {
  assert.equal(daysLeft("2026-10-20", "2026-10-18"), 2);
  assert.equal(daysLeft("2026-10-18", "2026-10-20"), -2);
});

test("recentQuarters: berakhir di kuartal berjalan, lintas tahun, urut lama → baru", () => {
  assert.deepEqual(recentQuarters("2026-10-18", 4), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  assert.deepEqual(recentQuarters("2026-02-01", 3), ["2025-Q3", "2025-Q4", "2026-Q1"]);
});

test("parsePeriods: default kuartal; format tak sah, terlalu banyak → 400; duplikat dibuang", () => {
  assert.equal(parsePeriods("", "2026-10-18").length, 4);
  assert.deepEqual(parsePeriods("2026-Q1, 2026-Q2,2026-Q1", "2026-10-18"), ["2026-Q1", "2026-Q2"]);
  assert.deepEqual(parsePeriods("2026-03,2026", "2026-10-18"), ["2026-03", "2026"]);
  assert.throws(() => parsePeriods("2026-Q5", "2026-10-18"), (e) => e instanceof PipError && e.status === 400);
  assert.throws(() => parsePeriods("2026-13", "2026-10-18"), PipError);
  assert.throws(() => parsePeriods("a,b", "2026-10-18"), PipError);
  assert.throws(() => parsePeriods("2020,2021,2022,2023,2024,2025,2026,2027,2028", "2026-10-18"), PipError);
});

test("buildSeries: delta = selisih dengan periode sebelumnya; null bila salah satu kosong; tanpa ambang", () => {
  const s = buildSeries(["a", "b", "c", "d"], new Map<string, number | null>([["a", 60], ["b", 71.5], ["c", null], ["d", 70]]));
  assert.deepEqual(s.map((p) => p.delta), [null, 11.5, null, null]);
  assert.equal(buildSeries(["a", "b"], new Map<string, number | null>([["a", 50], ["b", 40]]))[1].delta, -10); // turun tetap dilaporkan apa adanya
  assert.deepEqual(buildSeries([], new Map()), []);
});

test("parseGoal: goal wajib, target opsional", () => {
  assert.deepEqual(parseGoal({ goal: " Naikkan plan-report ", target: "" }), { goal: "Naikkan plan-report", target: null });
  assert.throws(() => parseGoal({ goal: "  " }), (e) => e instanceof PipError && e.field === "goal");
  assert.throws(() => parseGoal(null), PipError);
});

test("parseMilestone: tanggal sah & tidak sebelum mulai", () => {
  assert.deepEqual(parseMilestone({ judul: "M1", due_date: "2026-11-01" }, "2026-10-18"), { judul: "M1", due_date: "2026-11-01" });
  assert.throws(() => parseMilestone({ judul: "M1", due_date: "2026-10-01" }, "2026-10-18"), PipError);
  assert.throws(() => parseMilestone({ judul: "", due_date: "2026-11-01" }, "2026-10-18"), PipError);
  assert.throws(() => parseMilestone({ judul: "M", due_date: "bukan" }, "2026-10-18"), PipError);
});

test("parseOutcome: catatan wajib; extend wajib end_date baru setelah end_date sekarang; tanpa batas jumlah/durasi", () => {
  assert.deepEqual(parseOutcome({ outcome: "graduate", catatan: "ok" }, "2027-01-16"), { outcome: "graduate", catatan: "ok", end_date: null });
  assert.deepEqual(parseOutcome({ outcome: "terminate", catatan: "tidak membaik", end_date: "2030-01-01" }, "2027-01-16").end_date, null);
  assert.equal(parseOutcome({ outcome: "extend", catatan: "perlu waktu", end_date: "2031-01-01" }, "2027-01-16").end_date, "2031-01-01");
  assert.throws(() => parseOutcome({ outcome: "extend", catatan: "x" }, "2027-01-16"), (e) => e instanceof PipError && e.field === "end_date");
  assert.throws(() => parseOutcome({ outcome: "extend", catatan: "x", end_date: "2027-01-16" }, "2027-01-16"), PipError);
  assert.throws(() => parseOutcome({ outcome: "graduate" }, "2027-01-16"), (e) => e instanceof PipError && e.field === "catatan");
  assert.throws(() => parseOutcome({ outcome: "promote", catatan: "x" }, "2027-01-16"), PipError);
});
