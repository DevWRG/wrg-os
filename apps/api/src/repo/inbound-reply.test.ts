// Tes balasan #REPORT AM — khususnya penyebutan NAMA customer yang tak match plan.
// Sebelumnya balasan hanya memuat jumlah ("1⚠️"), sehingga AM tak punya cara tahu
// customer mana yang gagal dicocokkan; namanya sudah tersedia di unmatchedNames
// tapi tidak pernah dicetak. Murni (tanpa DB):
// `node --test apps/api/dist/repo/inbound-reply.test.js`.

import test from "node:test";
import assert from "node:assert/strict";

import { buildAmReportReply } from "./inbound.js";

const reply = (
  res: { matched: number; unmatched: number; unmatchedNames?: string[] },
  pendingPhoto: string[] = [],
) => buildAmReportReply("Budi", "2026-08-19", 3, res, 3, 2, pendingPhoto);

test("customer tak match plan disebut namanya, bukan cuma jumlahnya", () => {
  const s = reply({ matched: 2, unmatched: 1, unmatchedNames: ["Klinik Sehat"] });
  assert.match(s, /Match plan: 2✓ 1⚠️/);
  assert.match(s, /Di luar #PLAN hari ini \(1 customer\)/);
  assert.match(s, /Klinik Sehat/);
  // Instruksinya harus menyebut "lengkap" — resubmit #PLAN parsial menghapus
  // plan lain yang belum direport (insertSalesPlan: DELETE ... reported = false).
  assert.match(s, /#PLAN lengkap/);
});

test("beberapa customer tak match — semua disebut", () => {
  const s = reply({ matched: 1, unmatched: 2, unmatchedNames: ["Klinik Sehat", "RS Baru"] });
  assert.match(s, /\(2 customer\)/);
  assert.match(s, /Klinik Sehat, RS Baru/);
});

test("semua match → tak ada blok peringatan sama sekali", () => {
  const s = reply({ matched: 3, unmatched: 0, unmatchedNames: [] });
  assert.doesNotMatch(s, /⚠️/);
  assert.doesNotMatch(s, /Di luar #PLAN/);
  assert.match(s, /Match plan: 3✓/);
});

test("unmatchedNames absen (pemanggil lama) → tidak crash, tetap cetak jumlah", () => {
  const s = reply({ matched: 2, unmatched: 1 });
  assert.match(s, /Match plan: 2✓ 1⚠️/);
  assert.doesNotMatch(s, /Di luar #PLAN/);
});

test("blok foto pending tetap muncul berbarengan dengan blok tak-match", () => {
  const s = reply({ matched: 2, unmatched: 1, unmatchedNames: ["Klinik Sehat"] }, ["RS Al-Islam"]);
  assert.match(s, /Di luar #PLAN hari ini/);
  assert.match(s, /Foto visit belum ada \(1 customer\)/);
  // urutan: tak-match dulu, foto sesudahnya
  assert.ok(s.indexOf("Di luar #PLAN") < s.indexOf("Foto visit belum ada"));
});

// ── Watchdog geotag ──
// Foto yang menempel tapi tanpa koordinat tak akan pernah lolos filter menu
// Visits (`sales_plan.visit_lat IS NOT NULL`). Sebelum blok ini, balasan
// justru menutupnya dengan "✅ Semua foto visit lengkap." — kegagalan senyap
// yang membuat cakupan geotag Arif 24% / Aulia 40% bertahan berbulan-bulan.
const replyGeo = (tanpaGeo: { customer: string; adaOverlay: boolean }[], pendingPhoto: string[] = []) =>
  buildAmReportReply("Budi", "2026-08-19", 3, { matched: 3, unmatched: 0, unmatchedNames: [] }, 3, 3, pendingPhoto, tanpaGeo);

test("foto tanpa overlay geotag → disebut namanya + disuruh foto ulang", () => {
  const s = replyGeo([{ customer: "RS Mata Fatma", adaOverlay: false }]);
  assert.match(s, /Foto tanpa koordinat \(1 customer\)/);
  assert.match(s, /belum terhitung di menu Visits/);
  assert.match(s, /Tanpa overlay geotag: RS Mata Fatma/);
  assert.match(s, /foto ulang pakai Geo-Tagging Camera/);
  // jangan sarankan kirim-ulang-dari-galeri: overlay tak ikut
  assert.match(s, /galeri tak menolong/);
  assert.doesNotMatch(s, /Semua foto visit lengkap/);
});

test("overlay ada tapi koordinat gagal OCR → obatnya kirim ulang, bukan foto ulang", () => {
  const s = replyGeo([{ customer: "Rsud Sogaten", adaOverlay: true }]);
  assert.match(s, /Koordinat gagal dibaca: Rsud Sogaten/);
  assert.match(s, /kirim ulang fotonya/);
  assert.doesNotMatch(s, /Tanpa overlay geotag/);
});

test("dua sebab bercampur → dipisah per sebab, tiap customer di baris yang benar", () => {
  const s = replyGeo([
    { customer: "RS A", adaOverlay: false },
    { customer: "RS B", adaOverlay: true },
    { customer: "RS C", adaOverlay: false },
  ]);
  assert.match(s, /\(3 customer\)/);
  assert.match(s, /Tanpa overlay geotag: RS A, RS C/);
  assert.match(s, /Koordinat gagal dibaca: RS B/);
});

test("foto pending DAN foto tanpa koordinat bisa muncul bersamaan", () => {
  const s = replyGeo([{ customer: "RS B", adaOverlay: true }], ["RS Pending"]);
  assert.match(s, /Foto visit belum ada \(1 customer\)/);
  assert.match(s, /Foto tanpa koordinat \(1 customer\)/);
  assert.ok(s.indexOf("Foto visit belum ada") < s.indexOf("Foto tanpa koordinat"));
  assert.doesNotMatch(s, /Semua foto visit lengkap/);
});

test("semua foto ber-koordinat → tetap bilang lengkap, tanpa peringatan baru", () => {
  const s = replyGeo([]);
  assert.match(s, /✅ Semua foto visit lengkap/);
  assert.doesNotMatch(s, /tanpa koordinat/);
  assert.doesNotMatch(s, /⚠️/);
});

test("pemanggil lama (tanpa argumen tanpaGeo) tetap jalan", () => {
  const s = buildAmReportReply("Budi", "2026-08-19", 1, { matched: 1, unmatched: 0 }, 1, 1, []);
  assert.match(s, /✅ Semua foto visit lengkap/);
});
