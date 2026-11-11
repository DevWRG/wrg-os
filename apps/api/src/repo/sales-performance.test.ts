import assert from "node:assert/strict";
import { test } from "node:test";

import { periodRanges, targetTurunan } from "./sales.js";

test("periodRanges: minggu = Senin s/d as-of, hari = as-of", () => {
  const r = periodRanges("2026-11-11"); // Rabu
  assert.deepEqual(r.week, { from: "2026-11-09", to: "2026-11-11" });
  assert.deepEqual(r.day, { from: "2026-11-11", to: "2026-11-11" });
  assert.deepEqual(periodRanges("2026-11-09").week, { from: "2026-11-09", to: "2026-11-09" }); // Senin
  assert.deepEqual(periodRanges("2026-11-15").week, { from: "2026-11-09", to: "2026-11-15" }); // Minggu
  assert.deepEqual(periodRanges("2027-01-01").week, { from: "2026-12-28", to: "2027-01-01" }); // lintas tahun
  assert.deepEqual(r.month, { from: "2026-11-01", to: "2026-11-11" });
});

test("targetTurunan: tahunan ÷ 52 minggu dan ÷ 260 hari kerja, null tetap null", () => {
  assert.equal(targetTurunan(52_000, "week"), 1_000);
  assert.equal(targetTurunan(260_000, "day"), 1_000);
  assert.equal(targetTurunan(100, "week"), 2);
  assert.equal(targetTurunan(null, "day"), null);
});
