import { test } from "node:test";
import assert from "node:assert/strict";

import { normNamaTeknisi } from "./readinessboard.js";

// Teknisi dikenali dari nama PERSIS (dinormalisasi), bukan potongan — uji dev
// 11 Okt 2026: pushname "a" / "jar" dulu lolos sbg "Teknisi Agus".
test("normalisasi: huruf kecil + spasi dirapikan", () => {
  assert.equal(normNamaTeknisi("  Teknisi   Agus "), "teknisi agus");
  assert.equal(normNamaTeknisi(null), "");
});

test("potongan nama TIDAK sama dengan nama utuh", () => {
  assert.notEqual(normNamaTeknisi("a"), normNamaTeknisi("Teknisi Agus"));
  assert.notEqual(normNamaTeknisi("Joko"), normNamaTeknisi("Teknisi Joko"));
  assert.equal(normNamaTeknisi("teknisi AGUS"), normNamaTeknisi("Teknisi Agus"));
});
