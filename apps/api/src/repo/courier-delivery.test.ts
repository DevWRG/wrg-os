import { test } from "node:test";
import assert from "node:assert/strict";

import { rapikanNamaKurir } from "./courier-delivery.js";

// Nama kurir teks bebas: varian spasi harus jadi satu ejaan sebelum disimpan,
// kalau tidak ranking performa memecah satu kurir jadi beberapa baris.
test("rapikanNamaKurir merapikan spasi tepi & ganda, huruf dibiarkan", () => {
  assert.equal(rapikanNamaKurir("  JNE  "), "JNE");
  assert.equal(rapikanNamaKurir("J&T   Express"), "J&T Express");
  assert.equal(rapikanNamaKurir("Budi\t(internal)"), "Budi (internal)");
  assert.equal(rapikanNamaKurir("jne"), "jne");
});
