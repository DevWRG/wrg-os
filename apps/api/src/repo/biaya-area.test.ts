import { test } from "node:test";
import assert from "node:assert/strict";

import { gabungDasar, hppWajar, RASIO_HPP_MAKS, ringkasDasar, susunHppMencurigakan } from "./biaya-area.js";

test("ringkasDasar: buang kurung kota & nama ST", () => {
  assert.equal(ringkasDasar("kota di keterangan (BALI)"), "kota di keterangan");
  assert.equal(ringkasDasar("titik layanan ST KEDIRI"), "titik layanan ST");
  assert.equal(ringkasDasar("tak tertebak"), "tak tertebak");
});

test("gabungDasar: jumlahkan per dasar ringkas, terbesar dulu", () => {
  const r = gabungDasar([
    { dasar: "kota di keterangan (BALI)", jumlah: 10 },
    { dasar: "kota di keterangan (KEDIRI)", jumlah: 5 },
    { dasar: "tak tertebak", jumlah: 100 },
  ]);
  assert.deepEqual(r, [{ dasar: "tak tertebak", jumlah: 100 }, { dasar: "kota di keterangan", jumlah: 15 }]);
});

test("hppWajar: HPP per kemasan × qty satuan kecil ditolak, batas 3× net inklusif", () => {
  assert.equal(RASIO_HPP_MAKS, 3);
  assert.equal(hppWajar(100, 2, 300), true); // rugi wajar
  assert.equal(hppWajar(100, 9, 300), true); // tepat 3×
  assert.equal(hppWajar(100, 10, 300), false); // > 3×
  assert.equal(hppWajar(50_000, 1_000, 900_000), false); // HPP per box, qty per pcs
  assert.equal(hppWajar(10, 1, 0), false); // net 0 (bonus) → keluar
  assert.equal(hppWajar(10, 1, -5), false);
});

test("susunHppMencurigakan: rasio & harga per qty, null aman", () => {
  assert.deepEqual(
    susunHppMencurigakan({ item_no: "ITM-01", item_name: "Reagen Contoh", kode: "K-01", hpp: 50_000, qty: 1_000, unit: "PCS", net: 900_000 }),
    { item_no: "ITM-01", item_name: "Reagen Contoh", kode: "K-01", hpp: 50_000, qty: 1_000, unit: "PCS", net: 900_000, harga_per_qty: 900, rasio: 55.6 },
  );
  const nol = susunHppMencurigakan({ item_no: null, item_name: "Bonus Contoh", kode: null, hpp: 10, qty: 0, unit: "", net: 0 });
  assert.deepEqual([nol.harga_per_qty, nol.rasio, nol.unit, nol.kode], [null, null, null, null]);
});
