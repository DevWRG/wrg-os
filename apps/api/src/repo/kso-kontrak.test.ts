import assert from "node:assert/strict";
import { test } from "node:test";

import { alasanTolakStatus, bucketJatuhTempo, URUTAN_BUCKET } from "./kso-kontrak.js";

test("bucket jatuh tempo mengikuti spesifikasi 30/60/90/120 hari", () => {
  assert.equal(bucketJatuhTempo("AKTIF", -1), "LEWAT");
  assert.equal(bucketJatuhTempo("AKTIF", 0), "H30");
  assert.equal(bucketJatuhTempo("AKTIF", 30), "H30");
  assert.equal(bucketJatuhTempo("AKTIF", 31), "H60");
  assert.equal(bucketJatuhTempo("NEGO", 90), "H90");
  assert.equal(bucketJatuhTempo("AKTIF", 120), "H120");
  assert.equal(bucketJatuhTempo("AKTIF", 121), "AMAN");
  assert.equal(bucketJatuhTempo("AKTIF", null), "TANPA_TANGGAL");
});

test("kontrak RENEWED/LOST tak dikejar lagi, berapa pun tanggalnya", () => {
  assert.equal(bucketJatuhTempo("RENEWED", -400), "SELESAI");
  assert.equal(bucketJatuhTempo("LOST", 10), "SELESAI");
  assert.equal(URUTAN_BUCKET[0], "LEWAT"); // papan: paling mendesak dulu
});

test("RENEWED hanya lewat Perpanjang, bukan ubah status", () => {
  assert.match(alasanTolakStatus("AKTIF", "RENEWED") ?? "", /Perpanjang/);
  assert.match(alasanTolakStatus("RENEWED", "AKTIF") ?? "", /periode barunya/);
});

test("transisi wajar diizinkan; status sama ditolak", () => {
  assert.equal(alasanTolakStatus("AKTIF", "NEGO"), null);
  assert.equal(alasanTolakStatus("NEGO", "AKTIF"), null);
  assert.equal(alasanTolakStatus("NEGO", "LOST"), null);
  assert.match(alasanTolakStatus("AKTIF", "AKTIF") ?? "", /sudah berstatus/);
});

test("membuka kembali LOST wajib catatan", () => {
  assert.match(alasanTolakStatus("LOST", "AKTIF") ?? "", /catatan/);
  assert.match(alasanTolakStatus("LOST", "AKTIF", "   ") ?? "", /catatan/);
  assert.equal(alasanTolakStatus("LOST", "AKTIF", "faskes tanda tangan ulang"), null);
});
