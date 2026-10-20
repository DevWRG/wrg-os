import { test } from "node:test";
import assert from "node:assert/strict";
import { pesanFakturHilang } from "./accurateSync.js";

test("pesan 'Faktur Penjualan tidak tepat' (faktur dihapus di Accurate) dikenali", () => {
  assert.equal(pesanFakturHilang(["Faktur Penjualan tidak tepat"]), "Faktur Penjualan tidak tepat");
  assert.equal(pesanFakturHilang("faktur penjualan TIDAK TEPAT"), "faktur penjualan TIDAK TEPAT");
});

test("galat lain TIDAK dianggap faktur hilang — tak boleh berujung penghapusan", () => {
  for (const d of [
    undefined, null, [], {}, "",
    ["Session tidak valid"], ["Too Many Requests"], ["Data tidak ditemukan"],
    [{ message: "Faktur Penjualan tidak tepat" }], // bukan string → abaikan
    ["Pelanggan tidak tepat"],
  ]) {
    assert.equal(pesanFakturHilang(d), null, JSON.stringify(d));
  }
});
