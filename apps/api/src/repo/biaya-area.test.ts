import { test } from "node:test";
import assert from "node:assert/strict";

import { gabungDasar, ringkasDasar } from "./biaya-area.js";

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
