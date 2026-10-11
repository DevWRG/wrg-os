import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alasanTolakDokumen, alasanTolakStatus, bucketJatuhTempo, MAKS_DOKUMEN, namaAsliAman, tipeDariIsi, URUTAN_BUCKET,
} from "./kso-kontrak.js";

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

test("tipe dokumen ditentukan dari isi, bukan label MIME browser", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
  const exe = new TextEncoder().encode("MZ\x90\x00 bukan pdf");
  assert.equal(tipeDariIsi(pdf), "application/pdf");
  assert.equal(tipeDariIsi(png), "image/png");
  assert.equal(tipeDariIsi(jpg), "image/jpeg");
  assert.equal(tipeDariIsi(exe), null);
  assert.equal(tipeDariIsi(new TextEncoder().encode("<html>%PDF-")), null); // magic harus di awal
});

test("dokumen ditolak: jenis asing, kosong, > 8 MB, bukan PDF/JPG/PNG", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4");
  assert.equal(alasanTolakDokumen("MOU", pdf.length, pdf), null);
  assert.match(alasanTolakDokumen("KTP", pdf.length, pdf) ?? "", /jenis dokumen/);
  assert.match(alasanTolakDokumen("MOU", 0, new Uint8Array()) ?? "", /kosong/);
  assert.match(alasanTolakDokumen("BAST", MAKS_DOKUMEN + 1, pdf) ?? "", /8 MB/);
  assert.match(alasanTolakDokumen("ADDENDUM", 4, new TextEncoder().encode("abcd")) ?? "", /PDF, JPG, atau PNG/);
});

test("nama asli dibersihkan dari path, kutip, dan karakter kontrol", () => {
  assert.equal(namaAsliAman("../../etc/passwd"), "passwd");
  assert.equal(namaAsliAman("C:\\Users\\x\\MoU \"RSUD\".pdf"), "MoU RSUD.pdf");
  assert.equal(namaAsliAman("a\r\nb.pdf"), "ab.pdf");
  assert.equal(namaAsliAman("   "), "dokumen");
  assert.equal(namaAsliAman("x".repeat(400)).length, 150);
});
