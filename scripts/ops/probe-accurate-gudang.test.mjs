// Tes dua fungsi murni di probe-accurate-gudang.mjs. Tanpa jaringan, tanpa DB:
//   node --test scripts/ops/probe-accurate-gudang.test.mjs
//
// Yang diuji cuma bagian yang MENAFSIRKAN response, karena di situ probe bisa
// salah lapor: kalau `jejakGudang` gagal menemukan breakdown yang sebenarnya
// ada, kesimpulannya jadi "tidak tersedia" dan #836 ditutup atas dasar keliru.
// Fixture di bawah meniru bentuk-bentuk yang mungkin dikembalikan Accurate,
// bukan bentuk yang sudah dikonfirmasi — probe-nya memang alat penemuan.

import test from "node:test";
import assert from "node:assert/strict";

import { ringkasList, jejakGudang } from "./probe-accurate-gudang.mjs";

test("ringkasList mengenali dua bentuk list Accurate (d array & d.data array)", () => {
  assert.deepEqual(ringkasList({ d: [{ id: 1, name: "Gudang A" }] }), {
    bentuk: "list",
    jumlah: 1,
    kunciBaris: ["id", "name"],
  });
  assert.deepEqual(ringkasList({ d: { data: [{ id: 2, name: "Gudang B" }] } }), {
    bentuk: "list",
    jumlah: 1,
    kunciBaris: ["id", "name"],
  });
});

test("ringkasList tidak berpura-pura: non-list dilaporkan apa adanya", () => {
  const r = ringkasList({ d: { id: 9, name: "X", quantity: 5 } });
  assert.equal(r.bentuk, "bukan list");
  assert.deepEqual(r.kunciTeratas, ["id", "name", "quantity"]);
});

test("ringkasList aman untuk list kosong (tak ada baris untuk diambil kuncinya)", () => {
  assert.deepEqual(ringkasList({ d: [] }), { bentuk: "list", jumlah: 0, kunciBaris: [] });
});

test("jejakGudang menemukan breakdown yang BERSARANG — ini inti probe-nya", () => {
  // Kalau qty per gudang ternyata sudah ikut di detail item, puller tak butuh
  // endpoint baru sama sekali. Melewatkan ini = menutup #836 secara keliru.
  const detail = {
    id: 77,
    no: "FX80",
    quantity: 120,
    detailWarehouseData: [{ warehouse: { id: 1, name: "Gudang Sby" }, quantity: 80 }],
  };
  const jejak = jejakGudang(detail);
  const jalur = jejak.map((j) => j.jalur);
  assert.ok(jalur.includes("detailWarehouseData"), `tak ketemu di ${JSON.stringify(jalur)}`);
  assert.ok(jalur.includes("detailWarehouseData[0].warehouse"), `tak masuk ke elemen: ${JSON.stringify(jalur)}`);
  const akar = jejak.find((j) => j.jalur === "detailWarehouseData");
  assert.equal(akar.tipe, "array[1]");
  assert.deepEqual(akar.contoh, ["warehouse", "quantity"]);
});

test("jejakGudang cocok pada 'gudang' maupun 'warehouse', apa pun kapitalnya", () => {
  const jalur = jejakGudang({ stokGudang: [{ kode: "SBY", qty: 3 }], WarehouseId: 4 }).map((j) => j.jalur);
  assert.ok(jalur.includes("stokGudang"));
  assert.ok(jalur.includes("WarehouseId"));
});

test("jejakGudang tidak melaporkan apa-apa kalau memang tidak ada", () => {
  assert.deepEqual(jejakGudang({ id: 1, no: "A", quantity: 5, unit1: { name: "PCS" } }), []);
});

test("jejakGudang tahan struktur aneh: null, primitif, dan kedalaman berlebih", () => {
  assert.deepEqual(jejakGudang(null), []);
  assert.deepEqual(jejakGudang("bukan objek"), []);
  // Sarang 10 tingkat — batas depth 6 harus menghentikan rekursi, bukan melempar.
  let dalam = { warehouseX: 1 };
  for (let i = 0; i < 10; i++) dalam = { lapis: dalam };
  assert.doesNotThrow(() => jejakGudang(dalam));
});
