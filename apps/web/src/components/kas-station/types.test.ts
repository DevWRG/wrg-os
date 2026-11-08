import assert from "node:assert/strict";
import { test } from "node:test";

import { rentangTanggal } from "./types";

test("rentangTanggal: hari berurutan jadi satu rentang", () => {
  assert.equal(rentangTanggal(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]), "2–7 Nov 2026");
});

test("rentangTanggal: satu hari dan hari terpisah", () => {
  assert.equal(rentangTanggal(["2026-11-05"]), "5 Nov 2026");
  assert.equal(rentangTanggal(["2026-11-02", "2026-11-04", "2026-11-05"]), "2 Nov, 4–5 Nov 2026");
});

test("rentangTanggal: lintas bulan dan lintas tahun", () => {
  assert.equal(rentangTanggal(["2026-11-30", "2026-12-01", "2026-12-02"]), "30 Nov – 2 Des 2026");
  assert.equal(rentangTanggal(["2026-12-31", "2027-01-01"]), "31 Des 2026 – 1 Jan 2027");
});

test("rentangTanggal: urutan masuk & duplikat tak berpengaruh, kosong = string kosong", () => {
  assert.equal(rentangTanggal(["2026-11-04", "2026-11-02", "2026-11-03", "2026-11-03"]), "2–4 Nov 2026");
  assert.equal(rentangTanggal([]), "");
});
