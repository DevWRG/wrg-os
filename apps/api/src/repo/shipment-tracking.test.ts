import { test } from "node:test";
import assert from "node:assert/strict";

import { pelakuShippingWa } from "./shipment-tracking.js";

// Gerbang pengirim #KIRIM/#BAST/#BUKTI (uji dev 11 Okt 2026: siapa pun di grup
// mana pun bisa menutup pengiriman). Sah = staf roster, atau driver SJ itu
// lewat chat pribadi.
const dasar = { rosterNama: null, isDm: false, senderNumber: "", driverWaNumber: "081234567890", driverName: "Budi" };

test("staf roster → boleh, pelaku = nama roster (bukan pushname)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, rosterNama: "Diana" }), "Diana");
});

test("orang asing di grup → ditolak", () => {
  assert.equal(pelakuShippingWa({ ...dasar, senderNumber: "120363999999999999" }), null);
});

test("driver SJ lewat chat pribadi → boleh (0812 = 62812)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "6281234567890" }), "driver Budi");
});

test("driver SJ tapi di GRUP → ditolak (nomor tak tersedia di grup)", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: false, senderNumber: "6281234567890" }), null);
});

test("chat pribadi dari nomor lain / SJ tanpa nomor driver → ditolak", () => {
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "6281299990000" }), null);
  assert.equal(pelakuShippingWa({ ...dasar, isDm: true, senderNumber: "", driverWaNumber: null }), null);
});
