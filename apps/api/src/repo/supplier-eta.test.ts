import assert from "node:assert/strict";
import { test } from "node:test";

import { validateSupplierEtaPatch } from "./supplier-eta.js";

test("validateSupplierEtaPatch: field wajib kosong/spasi ditolak", () => {
  assert.equal(validateSupplierEtaPatch({ vendor_name: "" }), "vendor_name wajib diisi");
  assert.equal(validateSupplierEtaPatch({ vendor_name: "   " }), "vendor_name wajib diisi");
  assert.equal(validateSupplierEtaPatch({ item_desc: " \t" }), "item_desc wajib diisi");
  assert.equal(validateSupplierEtaPatch({ eta_date: "" }), "eta_date wajib diisi");
  assert.equal(validateSupplierEtaPatch({ vendor_name: null }), "vendor_name wajib diisi");
});

test("validateSupplierEtaPatch: field wajib yang tidak dikirim tidak dicek (PATCH parsial)", () => {
  assert.equal(validateSupplierEtaPatch({ status: "arrived" }), null);
  assert.equal(validateSupplierEtaPatch({}), null);
  assert.equal(validateSupplierEtaPatch({ vendor_name: "Supplier Contoh", item_desc: "Barang Uji", eta_date: "2026-01-10" }), null);
});

test("validateSupplierEtaPatch: body bukan objek ditolak", () => {
  assert.equal(validateSupplierEtaPatch(null), "body harus objek JSON");
  assert.equal(validateSupplierEtaPatch([]), "body harus objek JSON");
  assert.equal(validateSupplierEtaPatch("x"), "body harus objek JSON");
});
