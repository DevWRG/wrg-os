import { test } from "node:test";
import assert from "node:assert/strict";
import { ambangSah, buildRekapWa, rpRingkas, tabDari, terlambat, type BarisDo } from "./do-belum-faktur.js";

test("tabDari: hanya DO yang SEMUA barisnya KSO masuk tab KSO", () => {
  assert.equal(tabDari(["KSO", "kso "]), "kso");
  assert.equal(tabDari(["KSO", "REGULAR"]), "tagih");   // campuran tetap ditagih per DO
  assert.equal(tabDari(["KSO", null]), "tagih");        // satu baris tanpa kategori → jangan disembunyikan
  assert.equal(tabDari(["REGULAR"]), "tagih");
  assert.equal(tabDari([]), "tagih");                   // item belum tersinkron
});

test("terlambat: lewat ambang hari kerja, tab KSO tak pernah", () => {
  assert.equal(terlambat("tagih", 3, 3), false);
  assert.equal(terlambat("tagih", 4, 3), true);
  assert.equal(terlambat("kso", 40, 3), false);
  assert.equal(terlambat("tagih", 1, 0), true);
});

test("ambangSah: bulat 0–60", () => {
  assert.equal(ambangSah(3), 3);
  assert.equal(ambangSah("5"), 5);
  assert.equal(ambangSah(0), 0);
  assert.equal(ambangSah(2.5), null);
  assert.equal(ambangSah(-1), null);
  assert.equal(ambangSah(61), null);
  assert.equal(ambangSah(""), null);
  assert.equal(ambangSah("x"), null);
});


const baris = (o: Partial<BarisDo>): BarisDo => ({
  id: 1, nomor: "SJ-1", tanggal: "2026-11-02", status: "Dikirim", customer_id: 1, customer: "RS A", cabang: "MALANG", am: "AM Satu",
  kategori: "REGULAR", tab: "tagih", baris: 1, baris_sisa: 1, item_tersinkron: true, nilai: 2_500_000, umur_hari: 7, hari_kerja: 5, terlambat: true, ...o,
});

test("buildRekapWa: urut paling lama, per cabang, batas baris, tanpa <...>", () => {
  const rows = [
    baris({ id: 1, nomor: "SJ-A", hari_kerja: 5, cabang: "MALANG" }),
    baris({ id: 2, nomor: "SJ-B", hari_kerja: 12, cabang: "MADURA", nilai: null }),
    baris({ id: 3, nomor: "SJ-C", hari_kerja: 8, cabang: "MALANG" }),
  ];
  const t = buildRekapWa(rows, { do: 10, nilai: 40_000_000 }, 3, "2026-11-09", 2);
  assert.match(t, /^🧾 \*DO Belum Difaktur\* — Senin, 9 Nov 2026/);
  assert.match(t, /3 DO terkirim sudah lewat 3 hari kerja tanpa faktur · perkiraan Rp5 jt \(dari 10 DO yang belum difaktur, Rp40 jt\)/);
  assert.match(t, /Per cabang: MALANG 2 · MADURA 1/);
  const daftar = t.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(daftar.length, 2);
  assert.match(daftar[0], /^1\. SJ-B · RS A · 12 hari kerja · AM Satu$/); // nilai kosong tak ditulis
  assert.match(daftar[1], /^2\. SJ-C .* 8 hari kerja · Rp2,5 jt · AM Satu$/);
  assert.match(t, /… dan 1 lainnya\./);
  assert.doesNotMatch(t, /<[^>]+>/); // placeholder <...> hilang di WA
});

test("rpRingkas & nilai 0 tak ditulis di rekap", () => {
  assert.equal(rpRingkas(2_500_000), "Rp2,5 jt");
  assert.equal(rpRingkas(850_000), "Rp850 rb");
  const t = buildRekapWa([baris({ nomor: "SJ-0", nilai: 0 })], { do: 1, nilai: 0 }, 3, "2026-11-09");
  assert.match(t, /^1\. SJ-0 · RS A · 5 hari kerja · AM Satu$/m);
});
