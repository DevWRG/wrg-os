import { test } from "node:test";
import assert from "node:assert/strict";

import { DocTrackerError, HARI_DEFAULT, HARI_MAKS, parseHari, parseSoId, parseState } from "./doc-tracker.js";

test("parseHari: default, batas, dan nilai salah → 400", () => {
  assert.equal(parseHari(undefined), HARI_DEFAULT);
  assert.equal(parseHari(""), HARI_DEFAULT);
  assert.equal(parseHari("30"), 30);
  assert.equal(parseHari(String(HARI_MAKS)), HARI_MAKS);
  for (const salah of ["0", "-1", "1.5", "abc", "1e2", "0x10", String(HARI_MAKS + 1)]) {
    assert.throws(() => parseHari(salah), (e) => e instanceof DocTrackerError && e.status === 400, salah);
  }
});

test("parseState: nama state sah diterima, kosong = tanpa filter, selain itu 400", () => {
  assert.equal(parseState(undefined), null);
  assert.equal(parseState("executed"), "executed");
  assert.throws(() => parseState("Executed"), (e) => e instanceof DocTrackerError && e.status === 400);
  assert.throws(() => parseState("ngawur"), DocTrackerError);
  // Review/Approved dihapus 8 Nov 2026 — filter lama ditolak, bukan diam-diam kosong.
  assert.throws(() => parseState("review"), DocTrackerError);
  assert.throws(() => parseState("approved"), DocTrackerError);
});

test("parseSoId: bilangan bulat positif saja", () => {
  assert.equal(parseSoId("900001"), 900001);
  for (const salah of ["", "0", "-3", "1.2", "abc", "1e3", "../x"]) {
    assert.throws(() => parseSoId(salah), (e) => e instanceof DocTrackerError && e.status === 400, salah);
  }
});
