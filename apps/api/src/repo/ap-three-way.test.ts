import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TOLERANSI_PERSEN, bakukanDiskon, evaluasiBaris, evaluasiFaktur, fakturBatal, fakturDraft, keDesimal, penerimaanFinal, petakanBarisDetail, samaDesimal,
  type BarisFaktur, type KonteksBaris,
} from "./ap-three-way.js";

// F152 — logika murni 3-way match. Fixture SINTETIS berbentuk seperti sampel probe Accurate 19 Okt 2026
// (a = normal tanpa diskon, b = diskon 35% multi-PO draft, c = diskon 25% parsial). Data asli tidak di repo (PUBLIC).

const baris = (o: Partial<BarisFaktur> = {}): BarisFaktur => ({
  accurate_detail_id: 1, item_no: "PSG.0050", item_desc: "TABUNG", qty: 10, return_qty: 0, unit_name: "BOX",
  unit_price: 115000, disc_raw: "", disc_amount: 0, accurate_po_detail_id: 51603, accurate_receive_detail_id: 53350, ...o,
});
const konteks = (o: Partial<KonteksBaris> = {}): KonteksBaris => ({
  po: { qty_ordered: 10, unit: "BOX", unit_price: 115000, disc_raw: "" },
  penerimaan: { qty: 10, unit: "BOX", final: true },
  qty_lain_po: 0, qty_lain_penerimaan: 0, ...o,
});
const status = (b: Partial<BarisFaktur> = {}, k: Partial<KonteksBaris> = {}) => evaluasiBaris(baris(b), konteks(k)).status;

test("toleransi selisih = 0 (keputusan Direktur)", () => {
  assert.equal(TOLERANSI_PERSEN, 0);
});

// ── desimal tepat ──
test("keDesimal/samaDesimal: tepat tanpa float", () => {
  assert.equal(samaDesimal("10.10", 10.1), true);
  assert.equal(samaDesimal(1108057.5, "1108057.50"), true);
  assert.equal(samaDesimal("0.30000000", 0.3), true);
  assert.equal(samaDesimal("0.3", 0.1 + 0.2), true); // derau float di luar 9 desimal tak dianggap selisih
  assert.equal(samaDesimal("0.3", "0.300000001"), false); // tetapi selisih nyata di 9 desimal tertangkap
  assert.equal(samaDesimal(115000, 115000.01), false);
  assert.equal(samaDesimal(null, 1), false);
  assert.equal(samaDesimal("abc", 1), false);
  assert.equal(keDesimal(1e-7), 100n); // notasi eksponen JS tak merusak
  assert.equal(keDesimal(""), null);
});

test("bakukanDiskon: kosong/0 sama, kaskade, tak terbaca = null", () => {
  assert.equal(bakukanDiskon(""), "0");
  assert.equal(bakukanDiskon("0"), "0");
  assert.equal(bakukanDiskon("35"), bakukanDiskon("35.0"));
  assert.equal(bakukanDiskon("10+5"), "10000000000+5000000000");
  assert.notEqual(bakukanDiskon("10+5"), bakukanDiskon("15"));
  assert.equal(bakukanDiskon("abc"), null);
  assert.equal(bakukanDiskon(null), null);
});

// ── POSITIF ──
test("sampel a: 1 PO, 1 penerimaan, harga & qty sama → MATCH", () => {
  const r = evaluasiBaris(baris(), konteks());
  assert.equal(r.status, "MATCH");
  assert.deepEqual(r.temuan, []);
});

test("sampel b: diskon 35% sama dengan PO → MATCH", () => {
  assert.equal(
    status({ qty: 4, unit_price: 360000, disc_raw: "35", disc_amount: 504000, unit_name: "SET" },
      { po: { qty_ordered: 4, unit: "SET", unit_price: 360000, disc_raw: "35" }, penerimaan: { qty: 4, unit: "SET", final: true } }),
    "MATCH",
  );
});

test("sampel c: diskon 25% sama → MATCH (biaya pembulatan bukan baris barang)", () => {
  assert.equal(
    status({ qty: 6, unit_price: 66550, disc_raw: "25", disc_amount: 99825, unit_name: "VIAL" },
      { po: { qty_ordered: 6, unit: "VIAL", unit_price: 66550, disc_raw: "25" }, penerimaan: { qty: 6, unit: "VIAL", final: true } }),
    "MATCH",
  );
});

test("diskon kaskade sama '10+5' → MATCH", () => {
  assert.equal(status({ disc_raw: "10+5" }, { po: { qty_ordered: 10, unit: "BOX", unit_price: 115000, disc_raw: "10+5" } }), "MATCH");
});

test("parsial: faktur 6 dari 10 diterima, belum ada faktur lain → PARSIAL; faktur lain 4 melengkapi → MATCH", () => {
  assert.equal(status({ qty: 6 }), "PARSIAL");
  assert.equal(status({ qty: 6 }, { qty_lain_po: 4, qty_lain_penerimaan: 4 }), "MATCH");
});

test("beberapa penerimaan dijumlah per baris penerimaan: faktur 10 = diterima 10 → MATCH", () => {
  assert.equal(status({ qty: 10 }, { penerimaan: { qty: 10, unit: "BOX", final: true } }), "MATCH");
});

test("retur: qty netto = qty - return_qty dipakai", () => {
  assert.equal(status({ qty: 12, return_qty: 2 }), "MATCH");
});

test("satuan dibandingkan tanpa peduli huruf besar/spasi", () => {
  assert.equal(status({ unit_name: " box " }), "MATCH");
});

// ── NEGATIF ──
test("qty faktur > diterima → SELISIH_QTY", () => {
  const r = evaluasiBaris(baris({ qty: 11 }), konteks({ po: { qty_ordered: 20, unit: "BOX", unit_price: 115000, disc_raw: "" } }));
  assert.equal(r.status, "SELISIH_QTY");
  assert.match(r.temuan[0]!.pesan, /melebihi qty diterima/);
});

test("kumulatif faktur lain membuat melebihi diterima → SELISIH_QTY", () => {
  assert.equal(status({ qty: 6 }, { qty_lain_penerimaan: 5, qty_lain_po: 5 }), "SELISIH_QTY");
});

test("total difakturkan melebihi qty PO → SELISIH_QTY", () => {
  assert.equal(status({ qty: 10 }, { qty_lain_po: 1, penerimaan: { qty: 20, unit: "BOX", final: true } }), "SELISIH_QTY");
});

test("harga beda 0,01 → SELISIH_HARGA", () => {
  assert.equal(status({ unit_price: 115000.01 }), "SELISIH_HARGA");
});

test("diskon beda (35 vs 30) → SELISIH_HARGA", () => {
  assert.equal(status({ disc_raw: "35" }, { po: { qty_ordered: 10, unit: "BOX", unit_price: 115000, disc_raw: "30" } }), "SELISIH_HARGA");
});

test("diskon ada di faktur tapi tidak di PO → SELISIH_HARGA", () => {
  assert.equal(status({ disc_raw: "5" }), "SELISIH_HARGA");
});

test("potongan nominal faktur yang tak ada di PO → SELISIH_HARGA", () => {
  assert.equal(status({ disc_amount: 1000 }), "SELISIH_HARGA");
});

test("diskon tak terbaca → SELISIH_HARGA (tak boleh dianggap sama)", () => {
  assert.equal(status({ disc_raw: "x%" }), "SELISIH_HARGA");
});

test("satuan beda BOX vs PCS → SELISIH_SATUAN, tidak dikonversi diam-diam", () => {
  assert.equal(status({ unit_name: "PCS" }), "SELISIH_SATUAN");
  assert.equal(status({}, { penerimaan: { qty: 10, unit: "PCS", final: true } }), "SELISIH_SATUAN");
});

test("tanpa PO → TANPA_PO (bukan MATCH)", () => {
  assert.equal(status({ accurate_po_detail_id: null }, { po: null }), "TANPA_PO");
});

test("tanpa penerimaan → TANPA_PENERIMAAN", () => {
  assert.equal(status({ accurate_receive_detail_id: null }, { penerimaan: null }), "TANPA_PENERIMAAN");
});

test("penerimaan masih diajukan → PENERIMAAN_BELUM_FINAL", () => {
  assert.equal(status({}, { penerimaan: { qty: 10, unit: "BOX", final: false } }), "PENERIMAAN_BELUM_FINAL");
});

test("id ada tapi baris belum ada di cermin → BELUM_SINKRON, bukan SELISIH", () => {
  assert.equal(status({}, { po: null }), "BELUM_SINKRON");
  assert.equal(status({}, { penerimaan: null }), "BELUM_SINKRON");
});

test("diskon PO belum tersinkron (NULL) → BELUM_SINKRON", () => {
  assert.equal(status({}, { po: { qty_ordered: 10, unit: "BOX", unit_price: 115000, disc_raw: null } }), "BELUM_SINKRON");
});

test("selisih nyata mengalahkan tautan hilang (urutan keparahan)", () => {
  assert.equal(status({ unit_price: 1, accurate_receive_detail_id: null }, { penerimaan: null }), "SELISIH_HARGA");
});

// ── EDGE ──
test("qty tak terbaca atau retur > qty → SELISIH_QTY", () => {
  assert.equal(status({ qty: "abc" }), "SELISIH_QTY");
  assert.equal(status({ qty: 1, return_qty: 2 }), "SELISIH_QTY");
});

test("seluruh qty diretur (netto 0) → tak ada pembandingan qty", () => {
  assert.equal(status({ qty: 3, return_qty: 3 }), "MATCH");
});

test("desimal: 10,10 vs 10,1 sama; qty pecahan tepat", () => {
  assert.equal(status({ qty: "2.5" }, { po: { qty_ordered: "2.50", unit: "BOX", unit_price: "115000.00", disc_raw: "" }, penerimaan: { qty: "2.5", unit: "BOX", final: true } }), "MATCH");
});

test("penerimaanFinal / fakturDraft / fakturBatal", () => {
  assert.equal(penerimaanFinal("Diterima", "APPROVED"), true);
  assert.equal(penerimaanFinal("Difaktur", "APPROVED"), true);
  assert.equal(penerimaanFinal("Diajukan", "APPROVED"), false);
  assert.equal(penerimaanFinal("Diterima", "UNAPPROVED"), false);
  assert.equal(fakturDraft("DFT.23187 [PBG/1189-1026-WRG / 5296/12/10/2026]", "UNAPPROVED"), true);
  assert.equal(fakturDraft("PBG/1053-0926-WRG / 26IX0121", "APPROVED"), false);
  assert.equal(fakturDraft("PBG/1053-0926-WRG / 26IX0121", null), true);
  assert.equal(fakturBatal("Dibatalkan"), true);
  assert.equal(fakturBatal("Lunas"), false);
});

// ── status faktur ──
const final = { number: "PBG/1053-0926-WRG / 26IX0121", approval_status: "APPROVED", status_name: "Lunas" };
const h = (s: string) => ({ status: s as never, temuan: [] });

test("evaluasiFaktur: semua MATCH → MATCH", () => {
  const r = evaluasiFaktur(final, [h("MATCH"), h("MATCH")]);
  assert.equal(r.status, "MATCH");
  assert.deepEqual(r.per_status, { MATCH: 2 });
});

test("evaluasiFaktur: satu SELISIH → SELISIH; tautan hilang → BELUM_LENGKAP; parsial → PARSIAL", () => {
  assert.equal(evaluasiFaktur(final, [h("MATCH"), h("SELISIH_QTY"), h("TANPA_PO")]).status, "SELISIH");
  assert.equal(evaluasiFaktur(final, [h("MATCH"), h("TANPA_PO")]).status, "BELUM_LENGKAP");
  assert.equal(evaluasiFaktur(final, [h("PARSIAL"), h("MATCH")]).status, "PARSIAL");
  assert.equal(evaluasiFaktur(final, [h("PARSIAL"), h("BELUM_SINKRON")]).status, "BELUM_LENGKAP");
});

test("evaluasiFaktur: draft (sampel b) → DRAFT tapi pratinjau status baris tetap ada", () => {
  const r = evaluasiFaktur({ number: "DFT.23187 [X]", approval_status: "UNAPPROVED", status_name: "Diajukan" }, [h("SELISIH_HARGA")]);
  assert.equal(r.status, "DRAFT");
  assert.equal(r.status_baris, "SELISIH_HARGA");
});

test("evaluasiFaktur: batal & tanpa baris barang → DIABAIKAN", () => {
  assert.equal(evaluasiFaktur({ ...final, status_name: "Dibatalkan" }, [h("MATCH")]).status, "DIABAIKAN");
  const kosong = evaluasiFaktur(final, []);
  assert.equal(kosong.status, "DIABAIKAN");
  assert.equal(kosong.status_baris, null);
});

// ── pemetaan detail.do (bentuk sampel probe 19 Okt 2026, nilai sintetis) ──
test("petakanBarisDetail: id PO/penerimaan tingkat baris, diskon string, biaya diabaikan", () => {
  const d = {
    detailExpense: [{ id: 34900, amountCurrency: -0.5 }],
    detailItem: [
      { id: 52551, quantity: 6, unitPrice: 66550, itemDiscPercent: "25", itemCashDiscount: 99825, returnQuantity: 0, totalPrice: 299475,
        unitRatio: 1, itemUnit: { name: "VIAL" }, item: { no: "ELC.0004", name: "QC HIGH" },
        purchaseOrderId: 52653, purchaseOrderDetailId: 54112, purchaseOrder: { number: "PO-X" },
        receiveItemId: 54801, receiveItemDetailId: 55451, receiveItem: { number: "INB-X" } },
      { id: 52552, quantity: 1, unitPrice: 10, itemDiscPercent: "", purchaseOrderDetailId: null, receiveItemDetailId: undefined, item: { name: "JASA" } },
      { quantity: 1 }, // tanpa id → dibuang
    ],
  };
  const l = petakanBarisDetail(d);
  assert.equal(l.length, 2);
  assert.deepEqual(
    [l[0]!.accurate_po_detail_id, l[0]!.accurate_receive_detail_id, l[0]!.accurate_po_id, l[0]!.accurate_receive_id, l[0]!.disc_raw, l[0]!.unit_name, l[0]!.po_number, l[0]!.receive_number],
    [54112, 55451, 52653, 54801, "25", "VIAL", "PO-X", "INB-X"],
  );
  assert.equal(l[1]!.accurate_po_detail_id, null);
  assert.equal(l[1]!.accurate_receive_detail_id, null);
  assert.equal(l[1]!.disc_raw, "");
  assert.equal(l[1]!.unit_name, null);
  assert.deepEqual(petakanBarisDetail(undefined), []);
});
