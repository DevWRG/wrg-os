import assert from "node:assert/strict";
import { test } from "node:test";

import { edSudahLewat, tanggalLokalIso } from "./forecast-ed";

test("edSudahLewat: ED sebelum hari ini = sudah lewat", () => {
  assert.equal(edSudahLewat("2026-01-09", "2026-01-10"), true);
  assert.equal(edSudahLewat("2025-12-31T00:00:00.000Z", "2026-01-10"), true);
});

test("edSudahLewat: ED hari ini / ke depan = belum lewat (masih 'mendekati')", () => {
  assert.equal(edSudahLewat("2026-01-10", "2026-01-10"), false);
  assert.equal(edSudahLewat("2026-03-01", "2026-01-10"), false);
});

test("edSudahLewat: tanpa ED = tidak lewat", () => {
  assert.equal(edSudahLewat(null, "2026-01-10"), false);
  assert.equal(edSudahLewat(undefined, "2026-01-10"), false);
  assert.equal(edSudahLewat("", "2026-01-10"), false);
});

test("tanggalLokalIso: format YYYY-MM-DD berbasis tanggal lokal", () => {
  assert.equal(tanggalLokalIso(new Date(2026, 0, 5, 1, 30)), "2026-01-05");
  assert.equal(tanggalLokalIso(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});
