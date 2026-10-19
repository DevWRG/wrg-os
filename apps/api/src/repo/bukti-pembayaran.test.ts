import assert from "node:assert/strict";
import { test } from "node:test";

import { alasanTolakBukti, MAKS_BUKTI, normalisasiKode, tipeBukti } from "./bukti-pembayaran.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const TEKS = new TextEncoder().encode("ini bukan gambar, hanya teks biasa");

test("normalisasiKode: huruf besar, spasi pinggir dibuang", () => {
  assert.equal(normalisasiKode("  cn-00012 "), "CN-00012");
  assert.equal(normalisasiKode("PO/2026/0042"), "PO/2026/0042");
  assert.equal(normalisasiKode("ot-0007"), "OT-0007");
});

test("normalisasiKode menolak yang tak valid (termasuk spasi di tengah)", () => {
  for (const k of ["", " ", "A", "-CN1", "CN 00012", "CN-0001;DROP", "a".repeat(41), null, undefined, 123]) {
    assert.equal(normalisasiKode(k), null, String(k));
  }
});

test("tipeBukti membaca ISI berkas, bukan nama/label", () => {
  assert.equal(tipeBukti(PNG), "image/png");
  assert.equal(tipeBukti(JPG), "image/jpeg");
  assert.equal(tipeBukti(PDF), "application/pdf");
  assert.equal(tipeBukti(WEBP), "image/webp");
  assert.equal(tipeBukti(TEKS), null);
  assert.equal(tipeBukti(new Uint8Array()), null);
});

test("alasanTolakBukti: urutan & field", () => {
  assert.equal(alasanTolakBukti("CN-1", PNG.length, PNG), null);
  assert.equal(alasanTolakBukti(null, PNG.length, PNG)?.field, "kode");
  assert.equal(alasanTolakBukti("CN-1", 0, new Uint8Array())?.field, "file");
  assert.match(alasanTolakBukti("CN-1", MAKS_BUKTI + 1, PNG)?.pesan ?? "", /8 MB/);
  assert.match(alasanTolakBukti("CN-1", TEKS.length, TEKS)?.pesan ?? "", /JPG, PNG, WebP, atau PDF/);
});
