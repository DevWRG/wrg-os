import { test } from "node:test";
import assert from "node:assert/strict";

import { alasanTolakBayar, alasanTolakPutus, parseNominalRupiah, type AktorKlaim } from "./doc-klaim.js";

// Wewenang klaim reimburse (keputusan user 15 Okt 2026): HoD pengaju memutus,
// Finance membayar, pengaju tak boleh memutus/membayar klaimnya sendiri.
const staf: AktorKlaim = { userId: "u", amId: "budi", hodKey: null, role: "user", superuser: false, finance: false };
const klaim = { am_id: "andi", hod_key: "ika" };

test("HoD pengaju boleh memutus", () => {
  assert.equal(alasanTolakPutus(klaim, { ...staf, amId: "ika-am", hodKey: "ika" }), null);
});

test("HoD lain / staf biasa ditolak", () => {
  assert.match(alasanTolakPutus(klaim, { ...staf, hodKey: "rocky" }) ?? "", /Hanya HoD pengaju/);
  assert.match(alasanTolakPutus(klaim, staf) ?? "", /Hanya HoD pengaju/);
});

test("Direktur / admin / superuser boleh memutus", () => {
  assert.equal(alasanTolakPutus(klaim, { ...staf, role: "direktur" }), null);
  assert.equal(alasanTolakPutus(klaim, { ...staf, role: "admin" }), null);
  assert.equal(alasanTolakPutus(klaim, { ...staf, superuser: true }), null);
});

test("klaim sendiri ditolak — bahkan untuk HoD/direktur", () => {
  assert.match(alasanTolakPutus({ am_id: "ika-am", hod_key: "ika" }, { ...staf, amId: "ika-am", hodKey: "ika" }) ?? "", /sendiri/);
  assert.match(alasanTolakPutus(klaim, { ...staf, amId: "andi", role: "direktur" }) ?? "", /sendiri/);
});

test("HoD tak tercatat → hanya direktur/admin", () => {
  const tanpaHod = { am_id: "andi", hod_key: null };
  assert.match(alasanTolakPutus(tanpaHod, { ...staf, hodKey: "ika" }) ?? "", /Direktur\/admin/);
  assert.equal(alasanTolakPutus(tanpaHod, { ...staf, role: "direktur" }), null);
});

test("bayar: Finance / admin boleh, HoD & direktur bukan Finance ditolak", () => {
  assert.equal(alasanTolakBayar(klaim, { ...staf, finance: true }), null);
  assert.equal(alasanTolakBayar(klaim, { ...staf, role: "admin" }), null);
  assert.match(alasanTolakBayar(klaim, { ...staf, hodKey: "ika" }) ?? "", /Finance/);
  assert.match(alasanTolakBayar(klaim, { ...staf, role: "direktur" }) ?? "", /Finance/);
});

test("bayar klaim sendiri ditolak walau Finance", () => {
  assert.match(alasanTolakBayar(klaim, { ...staf, amId: "andi", finance: true }) ?? "", /sendiri/);
});

test("parseNominalRupiah: format nota umum", () => {
  assert.equal(parseNominalRupiah("Rp 150.000"), 150000);
  assert.equal(parseNominalRupiah("Rp150.000,00"), 150000);
  assert.equal(parseNominalRupiah("10,000"), 10000);
  assert.equal(parseNominalRupiah("150,000.00"), 150000);
  assert.equal(parseNominalRupiah("IDR 1.250.000"), 1250000);
  assert.equal(parseNominalRupiah("Rp 10.000,-"), 10000);
  assert.equal(parseNominalRupiah("150000"), 150000);
});

test("parseNominalRupiah: yang meragukan → null (tak ditebak)", () => {
  assert.equal(parseNominalRupiah(null), null);
  assert.equal(parseNominalRupiah(""), null);
  assert.equal(parseNominalRupiah("-500000"), null);
  assert.equal(parseNominalRupiah("sepuluh ribu"), null);
  assert.equal(parseNominalRupiah("10.5"), null);
  assert.equal(parseNominalRupiah("0"), null);
});
