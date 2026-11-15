import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bisaTautPo,
  deskripsiDokumen,
  kategoriDariKlasifikasi,
  kelompokkanRekap,
  kodeDokumen,
  periodeDariBulan,
  qtyEfektif,
  usulanMasihBerjalan,
} from "./forecast.js";

const e = (status: string, poDiterima = false, poMati = false) => ({ status, poDiterima, poMati });

test("usulanMasihBerjalan: draft & submitted selalu menahan usulan baru", () => {
  assert.equal(usulanMasihBerjalan(e("draft")), true);
  assert.equal(usulanMasihBerjalan(e("submitted")), true);
});

test("usulanMasihBerjalan: ordered menahan selama PO hidup & barang belum diterima", () => {
  assert.equal(usulanMasihBerjalan(e("ordered")), true);
  assert.equal(usulanMasihBerjalan(e("ordered", true)), false);
  assert.equal(usulanMasihBerjalan(e("ordered", false, true)), false);
});

test("usulanMasihBerjalan: dismissed tidak menahan", () => {
  assert.equal(usulanMasihBerjalan(e("dismissed")), false);
});

test("kategoriDariKlasifikasi: 01 = IVD, kategori lain = Medical, tanpa klasifikasi = null", () => {
  assert.equal(kategoriDariKlasifikasi("01"), "IVD");
  assert.equal(kategoriDariKlasifikasi("02"), "Medical");
  assert.equal(kategoriDariKlasifikasi("03"), "Medical");
  assert.equal(kategoriDariKlasifikasi(null), null);
});

test("kodeDokumen: gudang-bulan-kategori, nomor urut hanya bila sudah ada", () => {
  assert.equal(kodeDokumen("SBY", "2026-11-01", "IVD", 1), "FC-SBY-202611-IVD");
  assert.equal(kodeDokumen("SBY", "2026-11-01", "Medical", 2), "FC-SBY-202611-MED-2");
  assert.equal(kodeDokumen("JOGJA", "2026-01-01", null, 1), "FC-JOGJA-202601-NA");
});

test("periodeDariBulan: YYYY-MM → tanggal 1, format salah → null", () => {
  assert.equal(periodeDariBulan("2026-11"), "2026-11-01");
  assert.equal(periodeDariBulan("2026-13"), null);
  assert.equal(periodeDariBulan("11-2026"), null);
  assert.equal(periodeDariBulan(undefined), null);
});

test("qtyEfektif: qty final menang, kosong → usulan sistem", () => {
  assert.equal(qtyEfektif({ finalQty: 5, suggestedQty: 9 }), 5);
  assert.equal(qtyEfektif({ finalQty: null, suggestedQty: 9 }), 9);
});

test("deskripsiDokumen: ringkasan + rincian, dipotong 30 baris", () => {
  const baris = Array.from({ length: 32 }, (_, i) => ({
    itemName: `Barang ${i + 1}`, qty: 2, currentQty: 0, bufferQty: i === 0 ? 4 : null, edLewat: i === 1, nearEd: i === 1, notes: i === 0 ? "cek" : null,
  }));
  const d = deskripsiDokumen({ kode: "FC-SBY-202611-IVD", warehouseNama: "Gudang Surabaya", kategori: "IVD", periode: "2026-11-01", pipelineHot: 7 }, baris);
  assert.match(d, /Jumlah barang: 32 · Total qty: 64/);
  assert.match(d, /1\. Barang 1 — 2 \(stok 0, buffer 4\) — cek/);
  assert.match(d, /2\. Barang 2 — 2 \(stok 0 · ada batch lewat ED\)/);
  assert.match(d, /\(\+2 barang lainnya/);
  assert.doesNotMatch(d, /Barang 31 —/);
});

test("bisaTautPo: disetujui tanpa PO, atau PO mati", () => {
  assert.equal(bisaTautPo({ status: "submitted", poNumber: null, poMati: false }), true);
  assert.equal(bisaTautPo({ status: "ordered", poNumber: "1/PO", poMati: false }), false);
  assert.equal(bisaTautPo({ status: "ordered", poNumber: "1/PO", poMati: true }), true);
});

test("kelompokkanRekap: jumlahkan qty semua cabang per barang", () => {
  const base = { dokumenKode: "FC", status: "submitted", poNumber: null, poMati: false, notes: null, itemNo: null };
  const out = kelompokkanRekap([
    { ...base, suggestionId: "a", itemId: 2, itemName: "Reagen B", kategori: "IVD", warehouseKode: "SBY", warehouseNama: "Surabaya", qty: 10 },
    { ...base, suggestionId: "b", itemId: 2, itemName: "Reagen B", kategori: "IVD", warehouseKode: "SOLO", warehouseNama: "Solo", qty: 5, status: "ordered", poNumber: "9/PO" },
    { ...base, suggestionId: "c", itemId: 1, itemName: "Alat A", kategori: "Medical", warehouseKode: "SBY", warehouseNama: "Surabaya", qty: 1 },
  ]);
  assert.deepEqual(out.map((b) => [b.itemName, b.totalQty, b.cabang.length, b.belumPo]), [
    ["Reagen B", 15, 2, 1],
    ["Alat A", 1, 1, 1],
  ]);
});
