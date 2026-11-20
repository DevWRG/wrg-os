import { test } from "node:test";
import assert from "node:assert/strict";

import { pilihTab } from "./page-tabs";

const T = [{ key: "po", label: "PO" }, { key: "terima", label: "Penerimaan" }];

test("tab diminta & diizinkan dipakai; selain itu tab pertama", () => {
  assert.equal(pilihTab(T, "terima"), "terima");
  assert.equal(pilihTab(T, ["terima", "po"]), "terima");
  assert.equal(pilihTab(T, "rahasia"), "po");
  assert.equal(pilihTab(T, undefined), "po");
});

test("tab tak diizinkan tak bisa dipaksa lewat ?tab=", () => {
  assert.equal(pilihTab([{ key: "terima", label: "Penerimaan" }], "po"), "terima");
  assert.equal(pilihTab([], "po"), null);
});
