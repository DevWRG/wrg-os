import assert from "node:assert/strict";
import { test } from "node:test";

import { pilihKandidatDup, type DupNameCandidate } from "./hitl.js";

const kand: DupNameCandidate[] = [
  { kind: "accurate_customer", ref_id: "101", customer_name: "RSUD Contoh", am_id: null, cabang: null, score: 0.9, exact: false },
  { kind: "deal", ref_id: "d-2", customer_name: "RSUD Contoh", am_id: "A1", cabang: "X", score: 0.8, exact: true },
];

test("pilihKandidatDup: hanya kandidat yang ada di item; jenis harus cocok", () => {
  assert.equal(pilihKandidatDup(kand, { kind: "accurate_customer", ref_id: "101" })?.customer_name, "RSUD Contoh");
  assert.equal(pilihKandidatDup(kand, { kind: "deal", ref_id: "d-2" })?.am_id, "A1");
  assert.equal(pilihKandidatDup(kand, { kind: "deal", ref_id: "101" }), null, "id ada tapi jenis beda");
  assert.equal(pilihKandidatDup(kand, { kind: "accurate_customer", ref_id: "999" }), null, "bukan kandidat item ini");
  assert.equal(pilihKandidatDup(kand, undefined), null);
  assert.equal(pilihKandidatDup(undefined, { kind: "deal", ref_id: "d-2" }), null);
  assert.equal(pilihKandidatDup(kand, { kind: "lain" as "deal", ref_id: "d-2" }), null);
});
