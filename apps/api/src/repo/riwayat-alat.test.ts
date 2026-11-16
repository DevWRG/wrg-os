import assert from "node:assert/strict";
import { test } from "node:test";

import { bacaKunci } from "./riwayat-alat.js";
import { normSn } from "./asetTetapRekon.js";

test("kunci SN dari URL: dipangkas, tolak kosong/berspasi/terlalu panjang", () => {
  assert.equal(bacaKunci(" DJ02C16080040 "), "DJ02C16080040");
  assert.equal(bacaKunci("NOSN:rs-a|alat"), "NOSN:rs-a|alat");
  assert.throws(() => bacaKunci(""), /SN tidak valid/);
  assert.throws(() => bacaKunci(null), /SN tidak valid/);
  assert.throws(() => bacaKunci("AB 12"), /SN tidak valid/);
  assert.throws(() => bacaKunci("X".repeat(81)), /SN tidak valid/);
});

test("normSn (kunci kso_asset) — acuan alat_sn_key() di migrasi 328", () => {
  assert.equal(normSn(" 00829 "), "829");
  assert.equal(normSn("5360.0"), "5360");
  assert.equal(normSn("'ab 12c"), "AB12C");
  assert.equal(normSn("000"), "000");
});
