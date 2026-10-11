import { test } from "node:test";
import assert from "node:assert/strict";

import { normNamaTeknisi } from "./readinessboard.js";

// Teknisi dikenali dari nama PERSIS (dinormalisasi), bukan potongan — uji dev
// 11 Okt 2026: pushname "a" / "jar" dulu lolos sbg "Teknisi Fajar".
test("normalisasi: huruf kecil + spasi dirapikan", () => {
  assert.equal(normNamaTeknisi("  Teknisi   Fajar "), "teknisi fajar");
  assert.equal(normNamaTeknisi(null), "");
});

test("potongan nama TIDAK sama dengan nama utuh", () => {
  assert.notEqual(normNamaTeknisi("a"), normNamaTeknisi("Teknisi Fajar"));
  assert.notEqual(normNamaTeknisi("Gilang"), normNamaTeknisi("Teknisi Gilang"));
  assert.equal(normNamaTeknisi("teknisi FAJAR"), normNamaTeknisi("Teknisi Fajar"));
});
