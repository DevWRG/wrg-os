import assert from "node:assert/strict";
import { test } from "node:test";

import { balasanReportTeknisi, balasanStartTeknisi, balasanFormatSalah, fmtDurasi, parseTeknisiStart } from "./teknisi.js";

test("#START: satu nomor, beberapa nomor, label tebal WA", () => {
  assert.deepEqual(parseTeknisiStart("#START 1").nomor, [1]);
  assert.deepEqual(parseTeknisiStart("#START 1, 2").nomor, [1, 2]);
  assert.deepEqual(parseTeknisiStart("#start no 3 dan 4").nomor, [3, 4]);
  assert.deepEqual(parseTeknisiStart("*#START* 2").nomor, [2]);
  assert.deepEqual(parseTeknisiStart("#START\n5").nomor, [5]);
  assert.deepEqual(parseTeknisiStart("#START 1 1").nomor, [1]);
});

test("#START di luar plan: RS | SN/alat | jenis (label RS: boleh)", () => {
  const a = parseTeknisiStart("#START RS: RS Al Irsyad | DxH 560 | Service");
  assert.deepEqual(a.errors, []);
  assert.equal(a.baru?.faskes, "RS Al Irsyad");
  assert.equal(a.baru?.jenis, "Service");
  const b = parseTeknisiStart("#START RSUD A | 0832 | PM");
  assert.equal(b.baru?.sn, "0832");
});

test("#START format salah → galat, bukan tebakan", () => {
  assert.ok(parseTeknisiStart("#START").errors.length);
  assert.ok(parseTeknisiStart("#START 12a").errors.length);
  assert.ok(parseTeknisiStart("#START RS A | 0832").errors.length);
  assert.match(parseTeknisiStart("#START RS A | 0832 | Bongkar").errors[0], /Jenis "Bongkar" tak dikenal/);
});

test("fmtDurasi", () => {
  assert.equal(fmtDurasi(95), "1 j 35 m");
  assert.equal(fmtDurasi(45), "45 m");
  assert.equal(fmtDurasi(0), "0 m");
  assert.equal(fmtDurasi(null), null);
  assert.equal(fmtDurasi(-3), null);
});

test("balasan #START: ringkas, tanpa penilaian lokasi (lokasi dari foto report)", () => {
  const t = balasanStartTeknisi({
    nama: "Budi", jam: "09:05",
    mulai: [{ urut: 1, diLuarPlan: false }, { urut: 2, diLuarPlan: false }, { urut: 51, diLuarPlan: true }],
    ditolak: [{ urut: 3, alasan: "tak ada di #PLAN hari ini" }],
  });
  assert.equal(t, [
    "▶️ Mulai tercatat 09:05, Budi",
    "No. 1, 2",
    "No. 51 (di luar plan)",
    "⚠️ No. 3: tak ada di #PLAN hari ini",
    "",
    "Selesai → #REPORT 1 / 2 / 51 + foto Geo-Tagging Camera",
  ].join("\n"));
  assert.doesNotMatch(t, /tanpa lokasi|lokasi tercatat/);
});

test("balasan report: durasi & tanda tanpa #START", () => {
  const t = balasanReportTeknisi({
    faskes: "RS A",
    alat: [
      { nomor: 1, alatLabel: "EXC200", sn: "0832", jenis: "PM", status: "Selesai", alasan: null, masalah: null, durasiMenit: 95 },
      { nomor: 2, alatLabel: "Z3", sn: null, jenis: "Service", status: "Selesai", alasan: null, masalah: null, tanpaStart: true },
    ],
  });
  assert.match(t, /1\. EXC200 \(…0832\) · PM · Selesai · ⏱ 1 j 35 m/);
  assert.match(t, /2\. Z3 · Service · Selesai\n {3}⚠️ tanpa #START — waktu kerja tak terhitung/);
});

test("format salah #START memuat contoh", () => {
  assert.match(balasanFormatSalah("start", "Budi", ["x"]), /Start teknisi belum tersimpan, Budi[\s\S]*#START 1/);
});

test("#START <nama faskes> → semua pekerjaan di faskes itu", () => {
  const a = parseTeknisiStart("#START RSUD Trenggalek");
  assert.deepEqual(a.errors, []);
  assert.equal(a.faskes, "RSUD Trenggalek");
  assert.deepEqual(a.nomor, []);
  assert.equal(parseTeknisiStart("#START RS: RS Ujif175 Alfa").faskes, "RS Ujif175 Alfa");
  assert.equal(parseTeknisiStart("#start\nPKM Bakunase").faskes, "PKM Bakunase");
});

test("balasan #START: pesan umum (faskes tak ada di plan)", () => {
  const t = balasanStartTeknisi({ nama: "Budi", jam: "09:05", mulai: [], ditolak: [], pesan: ['Tak ada #PLAN hari ini untuk "RS X".'] });
  assert.equal(t, '⚠️ Tak ada #PLAN hari ini untuk "RS X".');
});

test("balasan report: tanda lokasi dari foto report", () => {
  const alat = [{ nomor: 1, alatLabel: "EXC200", sn: null, jenis: "PM", status: "Selesai", alasan: null, masalah: null }];
  assert.match(balasanReportTeknisi({ faskes: "RS A", alat, foto: 2, lokasi: "ada" }), /📷 2 foto terlampir\n📍 lokasi tercatat$/);
  assert.match(balasanReportTeknisi({ faskes: "RS A", alat, foto: 1, lokasi: "tanpa-geotag" }), /⚠️ foto tanpa geotag — pakai Geo-Tagging Camera/);
  assert.match(balasanReportTeknisi({ faskes: "RS A", alat, lokasi: "tanpa-foto" }), /📷 kirim foto Geo-Tagging Camera kunjungan ini \(boleh menyusul\)$/);
  assert.doesNotMatch(balasanReportTeknisi({ faskes: "RS A", alat }), /lokasi|Geo-Tagging/);
});
