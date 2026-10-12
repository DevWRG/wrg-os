import { test } from "node:test";
import assert from "node:assert/strict";

import { cabangDariNomorSj, parseSjRef, pelakuShippingWa } from "./shipment-tracking.js";

// Gerbang pengirim #KIRIM/#BAST/#BUKTI (uji dev 11 Okt 2026: siapa pun di grup
// mana pun bisa menutup pengiriman). Sah = staf roster, atau driver SJ itu
// lewat chat pribadi.
const dasar = { rosterNama: null, isDm: false, senderNumber: "", driverWaNumber: "081234567890", driverName: "Budi" };

test("staf roster → boleh, pelaku = nama roster (bukan pushname)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, rosterNama: "Diana" }), "Diana");
});

test("orang asing di grup → ditolak", () => {
  assert.equal(pelakuShippingWa({ ...dasar, senderNumber: "120363999999999999" }), null);
});

test("driver SJ lewat chat pribadi → boleh (0812 = 62812)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "6281234567890" }), "driver Budi");
});

test("driver SJ tapi di GRUP → ditolak (nomor tak tersedia di grup)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: false, senderNumber: "6281234567890" }), null);
});

test("chat pribadi dari nomor lain / SJ tanpa nomor driver → ditolak", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "6281299990000" }), null);
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "", driverWaNumber: null }), null);
});

// Rujukan SJ dari WA → DO Accurate (13 Okt 2026). Kurir mengetik jenis + angka
// urut; nomor lengkap Accurate tetap diterima apa adanya.
test("parseSjRef: bentuk ringkas jenis + angka (spasi, strip, nempel, huruf kecil)", () => {
  const harap = { full: null, jenis: "SJK", seq: "6142", cabang: null };
  assert.deepEqual(parseSjRef("SJK 6142"), harap);
  assert.deepEqual(parseSjRef("SJK-6142"), harap);
  assert.deepEqual(parseSjRef("sjk6142"), harap);
  assert.deepEqual(parseSjRef("  SJK  06142  "), harap);
});

test("parseSjRef: kode cabang opsional di belakang", () => {
  assert.deepEqual(parseSjRef("SJK 6142 jkt"), { full: null, jenis: "SJK", seq: "6142", cabang: "JKT" });
});

test("parseSjRef: angka saja diterima (jenis kosong → bisa ambigu, ditangani pemanggil)", () => {
  assert.deepEqual(parseSjRef("6142"), { full: null, jenis: null, seq: "6142", cabang: null });
});

test("parseSjRef: nomor lengkap Accurate → full + jenis/angka/cabang terurai", () => {
  assert.deepEqual(parseSjRef("SJK-PJ/III.6142-JKT/WRG/VIII/2026 barang 3 koli"), {
    full: "SJK-PJ/III.6142-JKT/WRG/VIII/2026",
    jenis: "SJK",
    seq: "6142",
    cabang: "JKT",
  });
  // salah ketik kode di Accurate tetap terurai (ada di data nyata)
  assert.equal(parseSjRef("SJK/-PJIII.5001-SBY/WRG/IX/2026")?.seq, "5001");
});

test("parseSjRef: nomor lama/bebas dicocokkan persis, tak dipaksa jadi angka urut", () => {
  assert.deepEqual(parseSjRef("SJ-2026-001"), { full: "SJ-2026-001", jenis: null, seq: null, cabang: null });
  assert.equal(parseSjRef("   "), null);
});

test("cabangDariNomorSj", () => {
  assert.equal(cabangDariNomorSj("SJR-PJ/I.6151-MLG/WRG/VIII/2026"), "MLG");
  assert.equal(cabangDariNomorSj("DEMO-DO/2026/07/0001"), null);
});
