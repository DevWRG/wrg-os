import { test } from "node:test";
import assert from "node:assert/strict";

import { gpPct, hppPerSatuan, susunKonversiRow, validasiKonversi } from "./hpp-konversi.js";

// Angka sintetis — bukan HPP/harga nyata.

test("hppPerSatuan: override menang, isi membagi HPP kemasan, tanpa konversi = kemasan", () => {
  assert.equal(hppPerSatuan(1000, 50, null), 20);
  assert.equal(hppPerSatuan(1000, 50, 7), 7);
  assert.equal(hppPerSatuan(1000, null, null), 1000);
  assert.equal(hppPerSatuan(null, 50, null), null);
  assert.equal(hppPerSatuan(null, null, 0), 0);
});

test("gpPct: konversi memulihkan GP yang minus palsu", () => {
  assert.equal(gpPct(3000, 100, 1000), -3233.3);
  assert.equal(gpPct(3000, 100, 20), 33.3);
  assert.equal(gpPct(0, 1, 1), null);
  assert.equal(gpPct(100, 1, null), null);
});

test("validasiKonversi: wajib salah satu, isi > 0, HPP ≥ 0, koma desimal", () => {
  assert.deepEqual(validasiKonversi({ item_id: 5, isi_per_kemasan: "2,5" }),
    { ok: true, v: { itemId: 5, isi: 2.5, hppSatuan: null, catatan: null } });
  assert.deepEqual(validasiKonversi({ item_id: "7", hpp_per_satuan: 0, catatan: "  label  " }),
    { ok: true, v: { itemId: 7, isi: null, hppSatuan: 0, catatan: "label" } });
  assert.equal(validasiKonversi({ item_id: 5 }).ok, false);
  assert.equal(validasiKonversi({ item_id: 5, isi_per_kemasan: 0 }).ok, false);
  assert.equal(validasiKonversi({ item_id: 5, hpp_per_satuan: -1 }).ok, false);
  assert.equal(validasiKonversi({ item_id: 5, isi_per_kemasan: "x" }).ok, false);
  assert.equal(validasiKonversi({ item_id: "abc", isi_per_kemasan: 1 }).ok, false);
  assert.equal(validasiKonversi({ item_id: -1, isi_per_kemasan: 1 }).ok, false);
});

test("susunKonversiRow: rasio dari HPP sekarang, null bila net ≤ 0", () => {
  const r = susunKonversiRow({ item_id: "9", item_name: "Item uji", hpp: 20, hpp_kemasan: 1000, qty: 100, net: 3000,
    sumber: "konversi", n_hpp: 1, isi_per_kemasan: 50, baris_curiga: 0 });
  assert.equal(r.item_id, 9);
  assert.equal(r.rasio, 0.7);
  assert.equal(r.hpp_per_satuan, null);
  assert.equal(susunKonversiRow({ item_id: 1, hpp: 5, qty: 1, net: 0 }).rasio, null);
  assert.equal(susunKonversiRow({ item_id: 1, hpp: null, qty: 1, net: 10 }).rasio, null);
});
