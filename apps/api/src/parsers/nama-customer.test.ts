// Tes pembersihan nama faskes sebelum dicocokkan ke plan. Murni (tanpa DB):
//   node --test apps/api/dist/parsers/nama-customer.test.js
//
// Aturannya sengaja SEMPIT — diturunkan dari data produksi, bukan dari dugaan:
// prefiks `cust` muncul 834x, sementara prefiks lain (`PT`, `dr`) justru bagian
// sah dari nama. Tanda kurung di ekor juga dibiarkan karena isinya catatan
// bermakna ("Laborat Sentral", "Semarang").

import test from "node:test";
import assert from "node:assert/strict";

import { bersihkanNamaCustomer } from "./am.js";

test("buang prefiks Cust dalam berbagai bentuk nyata", () => {
  assert.equal(bersihkanNamaCustomer("Cust : RS PHC"), "RS PHC");
  assert.equal(bersihkanNamaCustomer("cust: RS Wijaya Surabaya"), "RS Wijaya Surabaya");
  assert.equal(bersihkanNamaCustomer("Cust: Puskesmas Bagor"), "Puskesmas Bagor");
  assert.equal(bersihkanNamaCustomer("CUSTOMER : Klinik Ananda"), "Klinik Ananda");
  assert.equal(bersihkanNamaCustomer("Cust. RSUD Tripad"), "RSUD Tripad");
});

test("prefiks yang BERMAKNA tidak boleh dibuang", () => {
  // Muncul di data: `PT` nama perusahaan, `dr` nama dokter. Membuangnya
  // merusak nama, jadi aturannya dibatasi pada cust/customer saja.
  assert.equal(bersihkanNamaCustomer("PT : Nusantara Medika"), "PT : Nusantara Medika");
  assert.equal(bersihkanNamaCustomer("dr. Andi Praktek"), "dr. Andi Praktek");
  assert.equal(bersihkanNamaCustomer("Hasil : negosiasi"), "Hasil : negosiasi");
});

test("tanda kurung di ekor DIBIARKAN — isinya catatan bermakna", () => {
  assert.equal(bersihkanNamaCustomer("RS Bhakti Husada (Laborat Sentral)"), "RS Bhakti Husada (Laborat Sentral)");
  assert.equal(bersihkanNamaCustomer("Cust : Klinik X (Semarang)"), "Klinik X (Semarang)");
});

test("tidak pernah mengembalikan string kosong", () => {
  // Kalau nama HANYA berisi prefiks, kembalikan apa adanya — string kosong
  // akan membuat similarity() memasangkannya ke plan sembarang.
  assert.equal(bersihkanNamaCustomer("Cust :"), "Cust :");
  assert.equal(bersihkanNamaCustomer("cust:"), "cust:");
  assert.equal(bersihkanNamaCustomer("   "), "");
});

test("nama bersih tidak berubah", () => {
  assert.equal(bersihkanNamaCustomer("Puskesmas Bagor"), "Puskesmas Bagor");
  assert.equal(bersihkanNamaCustomer("  RSUD Tripad  "), "RSUD Tripad");
});
