import assert from "node:assert/strict";
import { test } from "node:test";

import { pecahSparepart } from "./riwayat-alat";

test("pecah isian sparepart jadi item", () => {
  assert.deepEqual(pecahSparepart("PSU Z50 Zybio · Board thermal printer"), ["PSU Z50 Zybio", "Board thermal printer"]);
  assert.deepEqual(pecahSparepart("Lampu halogen\nTube 2; Seal"), ["Lampu halogen", "Tube 2", "Seal"]);
  assert.deepEqual(pecahSparepart("Valve 3 Way XP-503V, 2 pcs"), ["Valve 3 Way XP-503V, 2 pcs"]);
  assert.deepEqual(pecahSparepart("-"), []);
  assert.deepEqual(pecahSparepart(null), []);
});
