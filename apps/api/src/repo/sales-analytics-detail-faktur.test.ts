// Alokasi netto & PPN faktur ke baris (ekspor Detail Faktur). Angka fiktif.
import test from "node:test";
import assert from "node:assert/strict";
import { susunBarisDetail, type BarisMentah } from "./sales-analytics-detail-faktur.js";

const baris = (o: Partial<BarisMentah>): BarisMentah => ({
  invoice_id: "1", line_no: 1, tanggal: "2026-01-07", nomor: "INV/001", inv_net: 0, inv_tax: 0,
  kode_customer: "C-1", customer: "UJI, RS KOTA CONTOH", kota: "KOTA CONTOH", provinsi: "JAWA TIMUR",
  cabang: "CABANG A", sales: "ABC", kode_barang: "X.1", nama_barang: "BARANG UJI", qty: 1, satuan: "BOX",
  harga: 0, total_baris: 0, use_tax: true, pengadaan: "RUTIN", nomor_sj: null, tgl_kirim: [], ...o,
});

test("tanpa diskon header: netto = totalPrice baris, PPN proporsional, diskon % dari harga", () => {
  const [a, b] = susunBarisDetail([
    baris({ line_no: 1, qty: 1, harga: 1000, total_baris: 900, inv_net: 1900, inv_tax: 209 }),
    baris({ line_no: 2, qty: 2, harga: 500, total_baris: 1000, inv_net: 1900, inv_tax: 209 }),
  ]);
  assert.equal(a!.total_harga, 1000);
  assert.equal(a!.netto, 900);
  assert.equal(a!.diskon_pct, 0.1);
  assert.equal(b!.netto, 1000);
  assert.equal(b!.diskon_pct, 0);
  assert.equal(a!.ppn + b!.ppn, 209);
  assert.equal(a!.total_ppn, a!.netto + a!.ppn);
  assert.equal(a!.tahun, 2026);
  assert.equal(a!.bulan, "01. JANUARI");
  assert.equal(a!.kena_ppn, "YA");
});

test("diskon header terserap: Σ netto baris = netto faktur", () => {
  const out = susunBarisDetail([
    baris({ line_no: 1, harga: 600, total_baris: 600, inv_net: 900, inv_tax: 99 }),
    baris({ line_no: 2, harga: 400, total_baris: 400, inv_net: 900, inv_tax: 99 }),
  ]);
  assert.equal(out[0]!.netto, 540);
  assert.equal(out[1]!.netto, 360);
  assert.equal(out[0]!.diskon_pct, 0.1);
});

test("baris tak kena pajak: PPN 0 & TIDAK; PPN faktur ke baris lain", () => {
  const [a, b] = susunBarisDetail([
    baris({ line_no: 1, harga: 100, total_baris: 100, inv_net: 300, inv_tax: 22, use_tax: false }),
    baris({ line_no: 2, harga: 200, total_baris: 200, inv_net: 300, inv_tax: 22, use_tax: true }),
  ]);
  assert.equal(a!.ppn, 0);
  assert.equal(a!.kena_ppn, "TIDAK");
  assert.equal(b!.ppn, 22);
  assert.equal(b!.kena_ppn, "YA");
});

test("flag useTax1 tak ada: ikut faktur", () => {
  const [a] = susunBarisDetail([baris({ harga: 100, total_baris: 100, inv_net: 100, inv_tax: 0, use_tax: null })]);
  assert.equal(a!.kena_ppn, "TIDAK");
  const [b] = susunBarisDetail([baris({ harga: 100, total_baris: 100, inv_net: 100, inv_tax: 11, use_tax: null })]);
  assert.equal(b!.kena_ppn, "YA");
  assert.equal(b!.ppn, 11);
});

test("faktur ber-PPN tapi semua baris bertanda tak kena: PPN tetap terbagi utuh", () => {
  const out = susunBarisDetail([
    baris({ line_no: 1, harga: 100, total_baris: 100, inv_net: 200, inv_tax: 22, use_tax: false }),
    baris({ line_no: 2, harga: 100, total_baris: 100, inv_net: 200, inv_tax: 22, use_tax: false }),
  ]);
  assert.equal(out[0]!.ppn + out[1]!.ppn, 22);
});

test("baris bernilai nol semua: netto dibagi rata, diskon % null bila harga 0", () => {
  const out = susunBarisDetail([
    baris({ line_no: 1, harga: 0, total_baris: 0, inv_net: 50, inv_tax: 0 }),
    baris({ line_no: 2, harga: 0, total_baris: 0, inv_net: 50, inv_tax: 0 }),
  ]);
  assert.equal(out[0]!.netto, 25);
  assert.equal(out[0]!.diskon_pct, null);
});

test("faktur berbeda dialokasikan terpisah, urutan dipertahankan", () => {
  const out = susunBarisDetail([
    baris({ invoice_id: "1", nomor: "A", harga: 100, total_baris: 100, inv_net: 100 }),
    baris({ invoice_id: "2", nomor: "B", harga: 100, total_baris: 100, inv_net: 80 }),
  ]);
  assert.deepEqual(out.map((r) => [r.nomor, r.netto]), [["A", 100], ["B", 80]]);
});
