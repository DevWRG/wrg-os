// Unit test parser #PLAN/#REPORT AM — fokus format terstruktur CRM Fase 1
// (F16 Visit Tracker) + jaminan format lama (pipe) tak regresi. Jalankan:
//   pnpm --filter @wrg/api exec node --import tsx --test src/parsers/am.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAmPlan, parseAmReport, normalizeActivityType } from "./am.js";

test("report: format em-dash [CUSTOMER] — [HASIL] — [NEXT STEP]", () => {
  const r = parseAmReport("#REPORT 21 Jul 2026\n1. RS Saiful Anwar — demo Cobas Pro — kirim SPH minggu depan");
  assert.equal(r.tanggal, "2026-07-21");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].customer, "RS Saiful Anwar");
  assert.equal(r.items[0].hasil, "demo Cobas Pro");
  assert.equal(r.items[0].next_action, "kirim SPH minggu depan");
});

test("report: segmen ke-4 = tipe aktivitas", () => {
  const r = parseAmReport("#REPORT\n1. Klinik Sehat — presentasi produk — follow up Senin — Presentasi");
  assert.equal(r.items[0].activity_type, "Presentasi");
});

test("report: tipe lewat baris `tipe:` + sinonim", () => {
  const r = parseAmReport("#REPORT\n1. Lab Mandiri\nhasil: diskusi harga\nnext: kirim penawaran\ntipe: telp");
  assert.equal(r.items[0].activity_type, "Telepon");
  assert.equal(r.items[0].hasil, "diskusi harga");
  assert.equal(r.items[0].next_action, "kirim penawaran");
});

test("report: tanpa tipe → null (caller yang menentukan default)", () => {
  const r = parseAmReport("#REPORT\n1. RS Umum — kunjungan rutin — tidak ada");
  assert.equal(r.items[0].activity_type, null);
});

test("report: format pipe lama tetap jalan", () => {
  const r = parseAmReport("#REPORT 5/7/2026\nRS A | ketemu dokter | kirim proposal");
  assert.equal(r.tanggal, "2026-07-05");
  assert.equal(r.items[0].customer, "RS A");
  assert.equal(r.items[0].hasil, "ketemu dokter");
  assert.equal(r.items[0].next_action, "kirim proposal");
});

// Hyphen biasa TIDAK boleh dipakai sbg pemisah — nama faskes sering mengandungnya.
test("report: hyphen di nama faskes tak memotong segmen", () => {
  const r = parseAmReport("#REPORT\n1. RS Al-Islam\nhasil: ketemu PIC lab");
  assert.equal(r.items[0].customer, "RS Al-Islam");
  assert.equal(r.items[0].hasil, "ketemu PIC lab");
});

test("plan: em-dash dipakai sbg pemisah customer | tujuan | goal", () => {
  const r = parseAmPlan("#PLAN 21 Jul 2026\n1. RS Saiful Anwar — kunjungan — closing KSO");
  assert.equal(r.customers.length, 1);
  assert.equal(r.customers[0].customer, "RS Saiful Anwar");
  assert.equal(r.customers[0].goal, "closing KSO");
});

test("normalizeActivityType: alias & tak dikenal", () => {
  assert.equal(normalizeActivityType("WhatsApp"), "WA");
  assert.equal(normalizeActivityType("kunjungan"), "Fisik");
  assert.equal(normalizeActivityType("FU"), "Follow-up");
  assert.equal(normalizeActivityType("entah apa"), null);
  assert.equal(normalizeActivityType(null), null);
});
