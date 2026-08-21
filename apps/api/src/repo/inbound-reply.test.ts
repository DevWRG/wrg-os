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
