import assert from "node:assert/strict";
import { test } from "node:test";

import { PER_HALAMAN, adalahKeyLaporan, angka, dariRasio, BARIS_PRATINJAU, dealTertutup, KEY_LAPORAN, nilaiMetrik, persen, pratinjau, rp, teks, urutDealLaporan, waktuWib } from "./report-library.js";

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

test("waktuWib: ISO UTC → tanggal & jam WIB terbaca; kosong '-'; bukan tanggal apa adanya", () => {
  assert.equal(waktuWib("2026-11-07T15:04:58.405Z"), "7 Nov 2026, 22.04 WIB");
  assert.equal(waktuWib("2026-12-31T17:30:00Z"), "1 Jan 2027, 00.30 WIB");
  assert.equal(waktuWib(null), "-");
  assert.equal(waktuWib(""), "-");
  assert.equal(waktuWib("W45"), "W45");
});

test("urutDealLaporan: deal berjalan dulu (nilai desc), Won/Lost di belakang", () => {
  const d = [
    { id: 1, stage: "Closing-Lost", estimate_amount: 900 },
    { id: 2, stage: "Presentation", estimate_amount: 100 },
    { id: 3, stage: "Closing-Won", estimate_amount: 500 },
    { id: 4, stage: "Negotiation", estimate_amount: 300 },
  ];
  assert.deepEqual(urutDealLaporan(d).map((x) => x.id), [4, 2, 1, 3]);
  assert.equal(dealTertutup("closing-won"), true);
  assert.equal(dealTertutup("Closing"), false);
  assert.equal(d[0].id, 1); // input tak diubah
});

test("pratinjau: halaman & ukuran halaman, total tetap jumlah sebenarnya", () => {
  const baris = Array.from({ length: 57 }, (_, i) => [String(i + 1)]);
  const l = { key: "stok" as const, judul: "x", ringkasan: [], header: ["n"], baris };
  const p2 = pratinjau(l, 2, 25);
  assert.deepEqual([p2.hal, p2.per, p2.total_baris, p2.baris.length, p2.baris[0][0]], [2, 25, 57, 7, "51"]);
  const lewat = pratinjau(l, 99, 50);
  assert.deepEqual([lewat.hal, lewat.baris[0][0]], [1, "51"]);
  const aneh = pratinjau(l, -3, 7);
  assert.deepEqual([aneh.hal, aneh.per, aneh.baris.length], [0, 10, 10]);
  assert.equal(pratinjau({ ...l, baris: [] }, 5, 25).hal, 0);
  assert.deepEqual([...PER_HALAMAN], [10, 25, 50, 100]);
});
