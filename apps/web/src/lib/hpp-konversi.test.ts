import assert from "node:assert/strict";
import { test } from "node:test";

import { bacaAngka, galatIsian, gpPct, hppPerSatuan } from "./hpp-konversi";

test("bacaAngka: kosong, koma desimal, ribuan gaya Indonesia, tak valid", () => {
  assert.equal(bacaAngka(""), null);
  assert.equal(bacaAngka("2,5"), 2.5);
  assert.equal(bacaAngka("2.5"), 2.5);
  assert.equal(bacaAngka("1.000,5"), 1000.5);
  assert.ok(Number.isNaN(bacaAngka("abc")));
});

test("hppPerSatuan: override menang, isi membagi, tanpa konversi = kemasan", () => {
  assert.equal(hppPerSatuan(1000, 50, null), 20);
  assert.equal(hppPerSatuan(1000, 50, 7), 7);
  assert.equal(hppPerSatuan(1000, null, null), 1000);
  assert.equal(hppPerSatuan(null, 50, null), null);
  assert.equal(hppPerSatuan(null, null, 3), 3);
});

test("gpPct: konversi mengubah GP minus jadi wajar", () => {
  // contoh sintetis: 100 satuan, net 3.000, HPP kemasan 1.000 isi 50
  assert.equal(gpPct(3000, 100, 1000), -3233.3);
  assert.equal(gpPct(3000, 100, hppPerSatuan(1000, 50, null)), 33.3);
  assert.equal(gpPct(0, 10, 5), null);
  assert.equal(gpPct(100, 10, null), null);
});

test("galatIsian", () => {
  assert.equal(galatIsian(null, null), "Isi per kemasan atau HPP per satuan wajib diisi");
  assert.equal(galatIsian(0, null), "Isi per kemasan harus lebih dari 0");
  assert.equal(galatIsian(null, -1), "HPP per satuan tidak boleh negatif");
  assert.equal(galatIsian(NaN, null), "Angka tidak valid");
  assert.equal(galatIsian(10, null), null);
  assert.equal(galatIsian(null, 0), null);
});
