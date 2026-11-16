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
  assert.ok(parseTeknisiStart("#START RSUD Trenggalek").errors.length);
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

test("balasan #START: ringkas, tanda lokasi, ajakan foto bila tanpa lokasi", () => {
  const t = balasanStartTeknisi({
    nama: "Budi", jam: "09:05",
    mulai: [{ urut: 1, diLuarPlan: false, berlokasi: true }, { urut: 51, diLuarPlan: true, berlokasi: false }],
    ditolak: [{ urut: 3, alasan: "tak ada di #PLAN hari ini" }],
  });
  assert.match(t, /^▶️ Mulai tercatat 09:05, Budi\nNo\. 1 · 📍 lokasi tercatat\nNo\. 51 \(di luar plan\) · ⚠️ tanpa lokasi/);
  assert.match(t, /⚠️ No\. 3: tak ada di #PLAN hari ini/);
  assert.match(t, /kirim foto Geo-Tagging Camera \(seperti foto kunjungan AM\) dengan caption #START/);
  assert.match(t, /Selesai → #REPORT 1 \/ 51$/);
  const semuaLokasi = balasanStartTeknisi({ nama: "Budi", jam: "09:05", mulai: [{ urut: 1, diLuarPlan: false, berlokasi: true }], ditolak: [] });
  assert.doesNotMatch(semuaLokasi, /Geo-Tagging Camera/);
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
