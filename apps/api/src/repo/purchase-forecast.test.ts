import { test } from "node:test";
import assert from "node:assert/strict";

import { gabungRingkasan, gapPercent, validateValue } from "./purchase-forecast.js";

// Rombak F41 13 Okt 2026: ringkasan forecast vs realisasi per lini/vendor/brand.
test("gabungRingkasan: kunci yang hanya punya forecast tetap tampil dengan realisasi 0", () => {
  const r = gabungRingkasan(
    [{ key: "ZYBIO", nilai: 900, po: 3 }],
    new Map([["ZYBIO", 1000], ["WONDFO", 500]]),
  );
  assert.deepEqual(r.map((x) => [x.key, x.forecast_value, x.actual_value, x.gap_value, x.gap_percent, x.po_count]), [
    ["ZYBIO", 1000, 900, -100, -10, 3],
    ["WONDFO", 500, 0, -500, -100, 0],
  ]);
});

test("gabungRingkasan: tanpa peta forecast (brand) → forecast & gap null", () => {
  const [b] = gabungRingkasan([{ key: "Belum terklasifikasi", nilai: 10, po: 1 }], null);
  assert.equal(b.forecast_value, null);
  assert.equal(b.gap_value, null);
  assert.equal(b.gap_percent, null);
});

test("gapPercent: forecast 0 → null (bukan Infinity)", () => {
  assert.equal(gapPercent(0, 100), null);
  assert.equal(gapPercent(200, 250), 25);
});

test("validateValue: tolak kosong/negatif/teks, terima angka & string angka", () => {
  for (const v of ["", "  ", -1, "abc", null, undefined, Number.NaN]) {
    assert.throws(() => validateValue(v), /forecast_value/);
  }
  assert.equal(validateValue("1500000"), 1500000);
  assert.equal(validateValue(0), 0);
});
