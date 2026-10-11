// Qty #SPH: digit polos 1–100.000 saja. Uji dev 12 Okt 2026: Number() menerima
// "1e9" dan "0x10" (=16), dan 99999999999 meledak "numeric field overflow" saat
// INSERT sehingga AM tak dibalas apa pun.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSphMessage } from "./sph.js";

const qtyOf = (q: string) => parseSphMessage(`#SPH RS Uji | RNI.0142 | ${q} | 5%`);

test("qty digit polos diterima", () => {
  assert.deepEqual(qtyOf("10"), { customerName: "RS Uji", kode: "RNI.0142", qty: 10, diskonRequested: 0.05 });
  assert.equal((qtyOf("100000") as { qty: number }).qty, 100000);
});

test("qty notasi ilmiah/heksa/pecahan/raksasa/nol ditolak", () => {
  for (const q of ["1e9", "0x10", "1.5", "1,5", "-5", "0", "100001", "99999999999", "10 box"]) {
    const r = qtyOf(q);
    assert.ok(r && "error" in r, `qty "${q}" harus ditolak`);
    assert.match((r as { error: string }).error, /bilangan bulat 1–100\.000/);
  }
});
