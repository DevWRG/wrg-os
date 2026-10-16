import { test } from "node:test";
import assert from "node:assert/strict";

import { periodeBanding, rentang, tumbuh } from "./product-scorecard.js";

// F6 Product Scorecard — periode pembanding & pertumbuhan (15 Okt 2026).

test("periodeBanding: sebelum = panjang sama tepat sebelum from; tahun lalu = tanggal sama", () => {
  const b = periodeBanding("2026-07-01", "2026-09-30");
  assert.equal(b.hari, 92);
  assert.deepEqual(b.sebelum, { from: "2026-03-31", to: "2026-06-30" });
  assert.deepEqual(b.tahun_lalu, { from: "2025-07-01", to: "2025-09-30" });
  // 29 Feb → 28 Feb tahun lalu
  assert.deepEqual(periodeBanding("2028-02-29", "2028-02-29").tahun_lalu, { from: "2027-02-28", to: "2027-02-28" });
  assert.deepEqual(periodeBanding("2026-10-01", "2026-10-01").sebelum, { from: "2026-09-30", to: "2026-09-30" });
});

test("tumbuh: null bila pembanding 0", () => {
  assert.equal(tumbuh(150, 100), 0.5);
  assert.equal(tumbuh(50, 100), -0.5);
  assert.equal(tumbuh(10, 0), null);
});

test("rentang: maksimal 366 hari, dibalik bila terbalik", () => {
  assert.deepEqual(rentang("2026-01-01", "2026-09-30"), { from: "2026-01-01", to: "2026-09-30", dipotong: false });
  const r = rentang("2024-01-01", "2026-09-30");
  assert.equal(r.dipotong, true);
  assert.equal(r.from, "2025-09-30");
  assert.deepEqual(rentang("2026-09-30", "2026-01-01"), { from: "2026-01-01", to: "2026-09-30", dipotong: false });
});
