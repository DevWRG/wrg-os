// Pipeline Dormant — logika murni (tanpa DB): pesan WA ke AM & HoD.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { pesanDormantAm, pesanDormantHod, type DormantItem } from "./deal-dormant.js";
import { DEAL_LOSS_REASONS, LOSS_TIDAK_BERGERAK } from "./deal.js";

const item = (i: number, over: Partial<DormantItem> = {}): DormantItem => ({
  deal_id: `d${i}`, faskes: `RS ${i}`, produk: "Wondfo OCG-102", stage: "Quotation",
  am_id: "15", am_nama: "Budi", am_wa: "62811", pic_hod: "rocky",
  gugur_at: new Date(2026, 11, 18), ...over,
});

test("pesan AM: Dormant baru menyebut tanggal gugur, tahap singkat, dan cara melepasnya", () => {
  const p = pesanDormantAm("Budi", { baru: [item(1)], ingat: [], gugur: [] });
  assert.match(p, /Deal Dormant\* — Budi, 1 deal sudah 45 hari/);
  assert.match(p, /RS 1 — Wondfo OCG-102 · Penawaran · gugur 18 Des/);
  assert.match(p, /#REPORT/);
  assert.match(p, /15 hari, deal otomatis jadi \*Lost\*/);
  // tanpa kurung sudut: placeholder <...> terbuang di WA
  assert.doesNotMatch(p, /[<>]/);
});

test("pesan AM: tiga bagian bisa muncul bersamaan; yang kosong tak ditulis", () => {
  const p = pesanDormantAm("Budi", { baru: [item(1)], ingat: [item(2)], gugur: [item(3)] });
  assert.match(p, /Deal Dormant/);
  assert.match(p, /Segera gugur\* — 1 deal Dormant jadi Lost dalam 3 hari/);
  assert.match(p, /Deal gugur jadi Lost\* — 1 deal 60\+ hari/);
  const hanyaGugur = pesanDormantAm("Budi", { baru: [], ingat: [], gugur: [item(3)] });
  assert.doesNotMatch(hanyaGugur, /Deal Dormant\*/);
  assert.match(hanyaGugur, /bisa dipindah lagi dari kolom Lost/);
  assert.equal(pesanDormantAm("Budi", { baru: [], ingat: [], gugur: [] }), "");
});

test("pesan AM/HoD: daftar dipotong 15 baris + sisa disebut", () => {
  const banyak = Array.from({ length: 18 }, (_, i) => item(i));
  assert.match(pesanDormantAm("Budi", { baru: banyak, ingat: [], gugur: [] }), /dan 3 deal lain/);
});

test("pesan HoD: menyebut AM tiap deal, deal tanpa AM ditandai", () => {
  const p = pesanDormantHod("Rocky", { baru: [item(1), item(2, { am_nama: null, am_id: null })], gugur: [item(3)] });
  assert.match(p, /Deal tim jadi Dormant\* — Rocky, 2 deal/);
  assert.match(p, /RS 1 .* · Budi/);
  assert.match(p, /BELUM ADA AM/);
  assert.match(p, /gugur jadi Lost\* — 1 deal/);
  assert.equal(pesanDormantHod("Rocky", { baru: [], gugur: [] }), "");
});

test("alasan 'tidak-bergerak' tak bisa dipilih manual (hanya job)", () => {
  assert.equal(DEAL_LOSS_REASONS.includes(LOSS_TIDAK_BERGERAK), false);
});
