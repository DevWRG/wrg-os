import { test } from "node:test";
import assert from "node:assert/strict";

import { EVENT_LABEL, fmtDelta, fmtScore, fmtSisaHari, fmtTgl, PIP_STATUS_LABEL } from "./pip-format";

test("fmtDelta: tanda arah, nol tanpa tanda, kosong = strip", () => {
  assert.equal(fmtDelta(11.5), "+11,5");
  assert.equal(fmtDelta(-3), "−3");
  assert.equal(fmtDelta(0), "0");
  assert.equal(fmtDelta(null), "–");
  assert.equal(fmtDelta(undefined), "–");
});

test("fmtScore & fmtSisaHari", () => {
  assert.equal(fmtScore(null), "–");
  assert.equal(fmtScore(72.46), "72,5");
  assert.equal(fmtSisaHari(5), "sisa 5 hari");
  assert.equal(fmtSisaHari(0), "berakhir hari ini");
  assert.equal(fmtSisaHari(-2), "lewat 2 hari");
  assert.equal(fmtSisaHari(null), "");
});

test("label PIP berbahasa pemakai & tanggal Indonesia", () => {
  assert.equal(PIP_STATUS_LABEL.graduate, "Lulus");
  assert.equal(PIP_STATUS_LABEL.terminate, "Tidak lulus");
  assert.equal(EVENT_LABEL["pip.outcome_extend"], "Hasil akhir: diperpanjang");
  assert.equal(fmtTgl("2026-11-09"), "9 Nov 2026");
  assert.equal(fmtTgl(null), "–");
  assert.equal(fmtTgl("bukan-tanggal"), "bukan-tanggal");
});
