import { test } from "node:test";
import assert from "node:assert/strict";

import { lokasiSama } from "./ga-asset-assignment.js";

// Relokasi menolak lokasi tujuan yang "sama" dengan lokasi sekarang, dan
// Transfer menolak perubahan lokasi (wajib lewat Relokasi + berita acara).
// Beda spasi/huruf besar bukan pindah lokasi.
test("lokasiSama: abaikan huruf besar, spasi tepi & spasi ganda", () => {
  assert.equal(lokasiSama("Kantor Surabaya", "  kantor   surabaya "), true);
  assert.equal(lokasiSama("Gudang SBY", "Gudang MLG"), false);
});

test("lokasiSama: kosong/null dianggap sama satu sama lain, beda dari lokasi terisi", () => {
  assert.equal(lokasiSama(null, ""), true);
  assert.equal(lokasiSama(undefined, "  "), true);
  assert.equal(lokasiSama(null, "Gudang SBY"), false);
});
