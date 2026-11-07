import { test } from "node:test";
import assert from "node:assert/strict";
import { ambangSah, tabDari, terlambat } from "./do-belum-faktur.js";

test("tabDari: hanya DO yang SEMUA barisnya KSO masuk tab KSO", () => {
  assert.equal(tabDari(["KSO", "kso "]), "kso");
  assert.equal(tabDari(["KSO", "REGULAR"]), "tagih");   // campuran tetap ditagih per DO
  assert.equal(tabDari(["KSO", null]), "tagih");        // satu baris tanpa kategori → jangan disembunyikan
  assert.equal(tabDari(["REGULAR"]), "tagih");
  assert.equal(tabDari([]), "tagih");                   // item belum tersinkron
});

test("terlambat: lewat ambang hari kerja, tab KSO tak pernah", () => {
  assert.equal(terlambat("tagih", 3, 3), false);
  assert.equal(terlambat("tagih", 4, 3), true);
  assert.equal(terlambat("kso", 40, 3), false);
  assert.equal(terlambat("tagih", 1, 0), true);
});

test("ambangSah: bulat 0–60", () => {
  assert.equal(ambangSah(3), 3);
  assert.equal(ambangSah("5"), 5);
  assert.equal(ambangSah(0), 0);
  assert.equal(ambangSah(2.5), null);
  assert.equal(ambangSah(-1), null);
  assert.equal(ambangSah(61), null);
  assert.equal(ambangSah(""), null);
  assert.equal(ambangSah("x"), null);
});
