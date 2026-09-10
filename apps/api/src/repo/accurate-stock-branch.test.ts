// Tes `ringkasStokPerGudang` — tempat tiga keputusan 2026-09-06 (#836) benar-
// benar berlaku. Murni, tanpa DB:
//   node --test apps/api/dist/repo/accurate-stock-branch.test.js
//
// Kenapa justru di sini yang diuji: kesalahan di fungsi ini TIDAK menghasilkan
// error. Ia menghasilkan angka stok yang salah — terlalu kecil (gudang
// terlewat), terlalu besar (dobel hitung), atau stok gudang milik CUSTOMER yang
// bocor ke layar AM. Ketiganya lolos build, lolos lint, dan tampil rapi di UI.
//
// Fixture id-nya nyata, dibaca dari warehouse/list.do di prod 2026-09-06:
// tiga gudang Surabaya = 100 / 2250 / 200, dan 96 gudang virtual milik customer
// (DINKES/PKM/LABKESDA) yang tak boleh ikut.

import test from "node:test";
import assert from "node:assert/strict";

import { ringkasStokPerGudang, type WarehouseMapRow } from "./accurateMirror.js";

// Cuplikan seed migrasi 166 — hanya yang dipakai tes ini.
const MAP: WarehouseMapRow[] = [
  { accurate_warehouse_id: 100, warehouse_kode: "SBY" },
  { accurate_warehouse_id: 2250, warehouse_kode: "SBY" },
  { accurate_warehouse_id: 200, warehouse_kode: "SBY" },
  { accurate_warehouse_id: 450, warehouse_kode: "JAKARTA" },
  { accurate_warehouse_id: 500, warehouse_kode: "JEMBER" },
];

const wh = (id: number, balance: unknown, warehouseName = "") => ({ id, balance, warehouseName });

test("tiga gudang Surabaya DIJUMLAHKAN jadi satu kode SBY", () => {
  // Keputusan #2. Kalau ini jadi "yang terakhir menang", stok SBY akan
  // terbaca 5 padahal sebenarnya 35 — dan tak ada yang error.
  const hasil = ringkasStokPerGudang(
    [wh(100, 20, "GUDANG SURABAYA"), wh(2250, 10, "GUDANG SURABAYA 1"), wh(200, 5, "GUDANG SURABAYA2")],
    MAP,
  );
  assert.equal(hasil.get("SBY"), 35);
  assert.equal(hasil.size, 1);
});

test("gudang di luar allowlist DIBUANG — termasuk yang namanya meyakinkan", () => {
  // Keputusan #1. 'GUDANG TEMPORARY' & 'GUDANG SPAREPART KSO' berawalan GUDANG
  // dan `suspended`-nya false, jadi dua heuristik yang sempat dipertimbangkan
  // akan meloloskan keduanya. Yang menahan hanya ketiadaan id di allowlist.
  const hasil = ringkasStokPerGudang(
    [
      wh(450, 7, "GUDANG JAKARTA"),
      wh(550, 999, "GUDANG TEMPORARY"),
      wh(150, 999, "GUDANG SPAREPART KSO"),
      wh(101, 999, "GUDANG PUSAT NOT AVAILABLE"),
    ],
    MAP,
  );
  assert.deepEqual([...hasil.entries()], [["JAKARTA", 7]]);
});

test("gudang VIRTUAL milik customer tak pernah lolos", () => {
  // Baris pertama detailWarehouseData di prod memang gudang customer.
  // Ini pagar arahan Direktur 2026-07-31, bukan sekadar kerapian data.
  const hasil = ringkasStokPerGudang(
    [wh(9001, 500, "DINKES KAB. BUTON UTARA"), wh(9002, 300, "PKM SUKAMAJU"), wh(500, 12, "GUDANG JEMBER")],
    MAP,
  );
  assert.deepEqual([...hasil.entries()], [["JEMBER", 12]]);
});

test("enam cabang yang di-skip tak pernah muncul sebagai kunci", () => {
  // Keputusan #3: LAMONGAN/TUBAN/JOGJA/SOLO/NTT tak punya baris di allowlist,
  // jadi puller tak boleh menyentuh stok mereka — angka CSV tetap berlaku.
  // NTB menyusul lewat migrasi 167: pemetaannya ke GUDANG MATARAM (id 600)
  // cuma kecocokan nama dan dicabut sampai ada yang mengonfirmasi.
  const hasil = ringkasStokPerGudang([wh(100, 3), wh(450, 4), wh(600, 99)], MAP);
  for (const kode of ["LAMONGAN", "TUBAN", "JOGJA", "SOLO", "NTT", "NTB"]) {
    assert.equal(hasil.has(kode), false, `${kode} tak boleh ditulis puller`);
  }
});

test("saldo negatif dijepit ke 0, bukan diteruskan", () => {
  // item_stock_branch.quantity punya CHECK (quantity >= 0). Tanpa jepitan ini
  // SATU baris minus menggagalkan insert SELURUH SKU itu.
  const hasil = ringkasStokPerGudang([wh(450, -5)], MAP);
  assert.equal(hasil.get("JAKARTA"), 0);
});

test("negatif di satu gudang Surabaya tidak mengurangi jumlah SBY", () => {
  // Konsekuensi jepitan di atas, dan ini yang benar: -10 di satu gudang bukan
  // alasan mengurangi stok gudang lain yang nyata ada barangnya.
  const hasil = ringkasStokPerGudang([wh(100, 20), wh(200, -10)], MAP);
  assert.equal(hasil.get("SBY"), 20);
});

test("balance/id yang tak masuk akal dilewati, bukan jadi NaN", () => {
  // NaN lolos ke SQL akan jadi error insert atau (lebih buruk) nilai aneh.
  const hasil = ringkasStokPerGudang(
    [wh(100, null), wh(2250, "abc"), wh(200, undefined), wh(450, "12"), { balance: 5 }, wh(NaN, 5)],
    MAP,
  );
  assert.equal(hasil.has("SBY"), false, "tak ada balance SBY yang sah");
  assert.equal(hasil.get("JAKARTA"), 12, "angka berbentuk string tetap diterima");
});

test("daftar kosong / allowlist kosong → hasil kosong, tanpa lempar", () => {
  assert.equal(ringkasStokPerGudang([], MAP).size, 0);
  assert.equal(ringkasStokPerGudang([wh(100, 5)], []).size, 0);
  // detailWarehouseData absen sama sekali (SKU jasa/non-stok).
  assert.equal(ringkasStokPerGudang(undefined as never, MAP).size, 0);
});

test("saldo 0 tetap tercatat sebagai kunci — pemanggil yang memutuskan", () => {
  // replaceItemStockBranch melewati qty <= 0 saat menulis. Pemisahan itu
  // disengaja: fungsi ini melaporkan apa yang dibaca, bukan menyembunyikannya.
  const hasil = ringkasStokPerGudang([wh(450, 0)], MAP);
  assert.equal(hasil.get("JAKARTA"), 0);
});
