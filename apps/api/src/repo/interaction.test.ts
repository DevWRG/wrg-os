// F95 Interaction Log — logika murni (tanpa DB): parser #CALL/#NOTE, saringan
// kandidat faskes, kursor timeline, dan pengenalan hashtag di detectKind.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { parseInteraksi, encodeKursor, decodeKursor, balasanFormat } from "./interaction.js";
import { detectKind } from "./inbound.js";

test("#CALL dengan titik dua: nama faskes | isi", () => {
  assert.deepEqual(parseInteraksi("#CALL RSUD Ngawi: konfirmasi PO minggu depan", "call"), {
    ok: true, customer: "RSUD Ngawi", isi: "konfirmasi PO minggu depan",
  });
});

test("pemisah | dan ' - ' juga diterima; tanda hubung di dalam nama tidak memotong", () => {
  assert.deepEqual(parseInteraksi("#note RS Islam Demo Husada | minta brosur", "note"),
    { ok: true, customer: "RS Islam Demo Husada", isi: "minta brosur" });
  assert.deepEqual(parseInteraksi("#CALL RS Ar-Rahman - tunda kunjungan", "call"),
    { ok: true, customer: "RS Ar-Rahman", isi: "tunda kunjungan" });
});

test("nama di baris hashtag, isi di baris berikutnya", () => {
  assert.deepEqual(parseInteraksi("#NOTE Klinik Pratama Demo Jaya\nKepala lab baru: dr. Sari\nminta demo alat", "note"), {
    ok: true, customer: "Klinik Pratama Demo Jaya", isi: "Kepala lab baru: dr. Sari\nminta demo alat",
  });
});

test("hashtag tidak di baris pertama tetap terbaca", () => {
  assert.deepEqual(parseInteraksi("Update siang ini\n#CALL RSUD Ngawi: sudah terima SPH", "call"),
    { ok: true, customer: "RSUD Ngawi", isi: "sudah terima SPH" });
});

test("tanpa pemisah & tanpa baris lanjutan → tanpa-isi (bukan menebak batas nama)", () => {
  assert.deepEqual(parseInteraksi("#CALL RS Islam Demo Husada minta brosur", "call"), { ok: false, alasan: "tanpa-isi" });
  assert.deepEqual(parseInteraksi("#CALL RSUD Ngawi:", "call"), { ok: false, alasan: "tanpa-isi" });
});

test("kosong / terlalu panjang", () => {
  assert.deepEqual(parseInteraksi("#CALL", "call"), { ok: false, alasan: "kosong" });
  assert.deepEqual(parseInteraksi("#CALL : isi tanpa nama", "call"), { ok: false, alasan: "kosong" });
  assert.deepEqual(parseInteraksi(null, "note"), { ok: false, alasan: "kosong" });
  assert.equal((parseInteraksi(`#NOTE RSUD Ngawi: ${"x".repeat(2001)}`, "note") as { alasan: string }).alasan, "terlalu-panjang");
});

test("detectKind mengenali #CALL/#NOTE, tapi tidak #NOTES/#CALLBACK", () => {
  assert.equal(detectKind("#CALL RSUD Ngawi: halo"), "call");
  assert.equal(detectKind("pengantar\n#note RS X: y"), "note");
  assert.equal(detectKind("#NOTES rapat"), "none");
  assert.equal(detectKind("#CALLBACK besok"), "none");
});

test("kursor timeline bolak-balik; kursor rusak = halaman pertama", () => {
  const k = encodeKursor({ waktu: "2026-10-12T17:00:00.000Z", jenis: "faktur", ref: "123" });
  assert.deepEqual(decodeKursor(k), ["2026-10-12T17:00:00.000Z", "faktur", "123"]);
  assert.equal(decodeKursor("bukan-base64-json"), null);
  assert.equal(decodeKursor(Buffer.from('["bukan tanggal","a","b"]').toString("base64url")), null);
  assert.equal(decodeKursor(null), null);
});

test("balasan format menyertakan contoh pakai", () => {
  assert.match(balasanFormat("call", "tanpa-isi", "Budi"), /#CALL RSUD Ngawi: /);
  assert.match(balasanFormat("note", "kosong", "Budi"), /#NOTE belum tercatat, Budi/);
});
