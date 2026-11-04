import assert from "node:assert/strict";
import { test } from "node:test";

import { polaPasswordAwal } from "./users.js";

test("polaPasswordAwal menolak pola password awal <panggilan>123", () => {
  for (const pw of ["dev123", "Rocky123", "  yogi123 ", "SARI123"]) assert.equal(polaPasswordAwal(pw), true, pw);
});

test("polaPasswordAwal meloloskan password lain", () => {
  for (const pw of ["dev1234", "123dev", "dev-123", "Kuat#2026x", "d3v123", ""]) assert.equal(polaPasswordAwal(pw), false, pw);
});
