import { test } from "node:test";
import assert from "node:assert/strict";

import { cekTipeFieldTender } from "./lpse-tender.js";

// F20 — tipe field body POST/PATCH dicek sebelum .trim() (dulu 500).

test("cekTipeFieldTender: body sah & field tak dikirim lolos", () => {
  assert.equal(cekTipeFieldTender({}), null);
  assert.equal(cekTipeFieldTender({ judul: "Tender Contoh", instansi: "Instansi X", pic_employee_id: "emp-1" }), null);
  assert.equal(cekTipeFieldTender({ tender_no: null, dept: null, notes: null, platform: null }), null);
});

test("cekTipeFieldTender: null di field wajib → wajib", () => {
  assert.equal(cekTipeFieldTender({ pic_employee_id: null }), "pic_employee_id wajib");
  assert.equal(cekTipeFieldTender({ judul: null }), "judul wajib");
});

test("cekTipeFieldTender: bukan teks → harus berupa teks", () => {
  assert.equal(cekTipeFieldTender({ judul: 123 }), "judul harus berupa teks");
  assert.equal(cekTipeFieldTender({ instansi: true }), "instansi harus berupa teks");
  assert.equal(cekTipeFieldTender({ notes: { a: 1 } }), "notes harus berupa teks");
  assert.equal(cekTipeFieldTender({ tender_no: 42 }), "tender_no harus berupa teks");
});

test("cekTipeFieldTender: body bukan objek ditolak", () => {
  assert.equal(cekTipeFieldTender(null), "body harus objek JSON");
  assert.equal(cekTipeFieldTender([] as unknown as Record<string, unknown>), "body harus objek JSON");
});
