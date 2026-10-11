import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDurasi, parseOvertimeArg } from "./overtime.js";

test("jam + menit + uraian dengan pemisah strip", () => {
  assert.deepEqual(parseOvertimeArg("2 jam 30 menit - closing laporan bulanan"), {
    menit: 150,
    uraian: "closing laporan bulanan",
  });
});

test("menit saja, pemisah titik dua", () => {
  assert.deepEqual(parseOvertimeArg("90 menit: susun stok opname"), { menit: 90, uraian: "susun stok opname" });
});

test("desimal koma & kata sambung 'untuk' dibuang", () => {
  assert.deepEqual(parseOvertimeArg("1,5 jam untuk input faktur"), { menit: 90, uraian: "input faktur" });
});

test("tanpa spasi antara angka dan satuan", () => {
  assert.deepEqual(parseOvertimeArg("2jam kirim barang ke gudang"), { menit: 120, uraian: "kirim barang ke gudang" });
});

test("angka di dalam uraian tidak dibaca sebagai durasi", () => {
  assert.deepEqual(parseOvertimeArg("1 jam input 20 faktur"), { menit: 60, uraian: "input 20 faktur" });
});

test("tanpa durasi → error", () => {
  assert.deepEqual(parseOvertimeArg("closing laporan"), { error: "durasi-tidak-terbaca" });
  assert.deepEqual(parseOvertimeArg("20 faktur"), { error: "durasi-tidak-terbaca" });
});

test("tanpa uraian → error", () => {
  assert.deepEqual(parseOvertimeArg("2 jam"), { error: "uraian-kosong" });
  assert.deepEqual(parseOvertimeArg("2 jam -"), { error: "uraian-kosong" });
});

test("kosong / nol / kepanjangan → error", () => {
  assert.deepEqual(parseOvertimeArg("   "), { error: "kosong" });
  assert.deepEqual(parseOvertimeArg("0 jam kerja"), { error: "durasi-nol" });
  assert.deepEqual(parseOvertimeArg("13 jam kerja"), { error: "durasi-terlalu-panjang" });
});

test("formatDurasi", () => {
  assert.equal(formatDurasi(150), "2 jam 30 menit");
  assert.equal(formatDurasi(120), "2 jam");
  assert.equal(formatDurasi(45), "45 menit");
});
