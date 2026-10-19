import assert from "node:assert/strict";
import { test } from "node:test";

import { adalahKeyLaporan, angka, dariRasio, BARIS_PRATINJAU, KEY_LAPORAN, nilaiMetrik, persen, pratinjau, rp, teks } from "./report-library.js";

test("adalahKeyLaporan hanya menerima 6 key resmi", () => {
  assert.equal(KEY_LAPORAN.length, 6);
  for (const k of KEY_LAPORAN) assert.equal(adalahKeyLaporan(k), true);
  for (const k of ["", "reports", "../x", "KPI-HOD"]) assert.equal(adalahKeyLaporan(k), false);
});

test("pemformat angka: rupiah, persen, kosong", () => {
  assert.equal(rp(1234567), "Rp 1.234.567");
  assert.equal(rp(null), "-");
  assert.equal(persen(12.34), "12,3%");
  assert.equal(dariRasio(1.016), "101,6%");
  assert.equal(dariRasio(0.25), "25%");
  assert.equal(dariRasio(null), "-");
  assert.equal(angka(1500.5, 1), "1.500,5");
  assert.equal(angka(undefined), "-");
  assert.equal(teks(""), "-");
  assert.equal(teks(0), "0");
});

test("nilaiMetrik menurut satuan", () => {
  assert.equal(nilaiMetrik(2500000, "Rp"), "Rp 2.500.000");
  assert.equal(nilaiMetrik(80, "%"), "80%");
  assert.equal(nilaiMetrik(3, "hari"), "3 hari");
  assert.equal(nilaiMetrik(null, "%"), "-");
});

test("pratinjau memotong ke BARIS_PRATINJAU tapi menyimpan total", () => {
  const baris = Array.from({ length: 25 }, (_, i) => [String(i)]);
  const p = pratinjau({ key: "stok", judul: "x", ringkasan: [], header: ["n"], baris });
  assert.equal(p.baris.length, BARIS_PRATINJAU);
  assert.equal(p.total_baris, 25);
});
