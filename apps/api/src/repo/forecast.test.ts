import assert from "node:assert/strict";
import { test } from "node:test";

import { usulanMasihBerjalan } from "./forecast.js";

const e = (status: string, poDiterima = false, poMati = false) => ({ status, poDiterima, poMati });

test("usulanMasihBerjalan: draft & submitted selalu menahan usulan baru", () => {
  assert.equal(usulanMasihBerjalan(e("draft")), true);
  assert.equal(usulanMasihBerjalan(e("submitted")), true);
});

test("usulanMasihBerjalan: ordered menahan selama PO hidup & barang belum diterima", () => {
  assert.equal(usulanMasihBerjalan(e("ordered")), true);
  assert.equal(usulanMasihBerjalan(e("ordered", true)), false);
  assert.equal(usulanMasihBerjalan(e("ordered", false, true)), false);
});

test("usulanMasihBerjalan: dismissed tidak menahan", () => {
  assert.equal(usulanMasihBerjalan(e("dismissed")), false);
});
