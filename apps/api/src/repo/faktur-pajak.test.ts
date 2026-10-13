import { test } from "node:test";
import assert from "node:assert/strict";

import { FakturPajakError, batasTerbit, bolehPindah, cekBuktiUrl, cekNomorFp, cekPindah, masaPajak, terlambat } from "./faktur-pajak.js";

// F27 — logika murni tracker Faktur Pajak.

test("masa pajak = bulan invoice", () => {
  assert.equal(masaPajak("2026-09-30"), "2026-09");
});

test("batas terbit = tgl 15 bulan berikutnya; Desember melompat ke Januari tahun depan", () => {
  assert.equal(batasTerbit("2026-09-30"), "2026-10-15");
  assert.equal(batasTerbit("2026-01-01"), "2026-02-15");
  assert.equal(batasTerbit("2026-12-31"), "2027-01-15");
});

test("terlambat: hanya FP belum selesai/dibatalkan yang lewat batas; tepat di batas belum terlambat", () => {
  const r = (status: "diminta" | "selesai" | "dibatalkan") => ({ status, batas_terbit: "2026-10-15" });
  assert.equal(terlambat(r("diminta"), "2026-10-15"), false);
  assert.equal(terlambat(r("diminta"), "2026-10-16"), true);
  assert.equal(terlambat(r("selesai"), "2026-11-01"), false);
  assert.equal(terlambat(r("dibatalkan"), "2026-11-01"), false);
});

test("peta perpindahan: satu langkah, final tak bisa pindah, tak boleh loncat", () => {
  assert.equal(bolehPindah("diminta", "diinput_coretax"), true);
  assert.equal(bolehPindah("diminta", "disetujui"), false);
  assert.equal(bolehPindah("diinput_coretax", "diminta"), true);
  assert.equal(bolehPindah("disetujui", "selesai"), true);
  assert.equal(bolehPindah("selesai", "dibatalkan"), false);
  assert.equal(bolehPindah("dibatalkan", "diminta"), false);
});

test("nomor FP: wajib, 10–25 karakter angka/titik/strip", () => {
  assert.equal(cekNomorFp(" 010.000-26.00000001 "), "010.000-26.00000001");
  assert.throws(() => cekNomorFp(""), FakturPajakError);
  assert.throws(() => cekNomorFp("123"), FakturPajakError);
  assert.throws(() => cekNomorFp("ABCDEFGHIJKLMN"), FakturPajakError);
});

test("bukti: wajib & harus https", () => {
  assert.equal(cekBuktiUrl("https://drive.google.com/file/d/x"), "https://drive.google.com/file/d/x");
  assert.throws(() => cekBuktiUrl("http://drive.google.com/x"), FakturPajakError);
  assert.throws(() => cekBuktiUrl("javascript:alert(1)"), FakturPajakError);
  assert.throws(() => cekBuktiUrl("bukan url"), FakturPajakError);
  assert.throws(() => cekBuktiUrl(null), FakturPajakError);
});

test("cekPindah: disetujui butuh nomor_fp, selesai butuh bukti, mundur/batal butuh alasan", () => {
  assert.throws(() => cekPindah("diinput_coretax", "disetujui", {}), /nomor_fp/);
  assert.equal(cekPindah("diinput_coretax", "disetujui", { nomor_fp: "0100002600000001" }).nomor_fp, "0100002600000001");
  assert.throws(() => cekPindah("disetujui", "selesai", {}), /bukti_url/);
  assert.throws(() => cekPindah("disetujui", "diinput_coretax", {}), /alasan/);
  assert.equal(cekPindah("disetujui", "diinput_coretax", { catatan: "NPWP salah" }).ke, "diinput_coretax");
  assert.throws(() => cekPindah("diminta", "dibatalkan", { catatan: "  " }), /alasan/);
  assert.equal(cekPindah("diminta", "dibatalkan", { catatan: "invoice diretur" }).ke, "dibatalkan");
});

test("cekPindah: status tak dikenal 400, langkah terlarang 409", () => {
  assert.throws(() => cekPindah("diminta", "meledak", {}), (e) => e instanceof FakturPajakError && e.status === 400);
  assert.throws(() => cekPindah("diminta", "selesai", { bukti_url: "https://x.id/a" }), (e) => e instanceof FakturPajakError && e.status === 409);
  assert.throws(() => cekPindah("selesai", "diminta", { catatan: "x" }), (e) => e instanceof FakturPajakError && e.status === 409);
});
