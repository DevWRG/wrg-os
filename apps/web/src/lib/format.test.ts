import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAngka, fmtRp, fmtRpRingkas } from "./format";

const n = (s: string) => s.replace(/ /g, " ");

test("fmtRpRingkas: desimal koma, satuan seragam", () => {
  assert.equal(fmtRpRingkas(19_630_000_000), "Rp 19,63 M");
  assert.equal(fmtRpRingkas(2_000_000_000), "Rp 2 M");
  assert.equal(fmtRpRingkas(1_250_000_000_000), "Rp 1,25 T");
  assert.equal(fmtRpRingkas(949_600_000), "Rp 950 jt");
  assert.equal(fmtRpRingkas(1_550_000, { desimalJt: 1 }), "Rp 1,6 jt");
  assert.equal(fmtRpRingkas(-3_400_000_000), "Rp -3,4 M");
  assert.equal(fmtRpRingkas(1_200_000_000, { rapat: true }), "Rp 1,2M");
});

test("fmtRpRingkas: di bawah 1 jt = Rupiah penuh; null = Rp 0", () => {
  assert.equal(n(fmtRpRingkas(950_000)), "Rp 950.000");
  assert.equal(n(fmtRpRingkas(null)), "Rp 0");
});

test("fmtRp & fmtAngka", () => {
  assert.equal(n(fmtRp(1_250_000)), "Rp 1.250.000");
  assert.equal(fmtAngka(22712), "22.712");
  assert.equal(fmtAngka(1.5), "1,5");
  assert.equal(fmtAngka(null), "—");
});
