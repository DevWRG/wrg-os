import { test } from "node:test";
import assert from "node:assert/strict";

import { picformGate } from "./picform-access";

test("sub-path picform dipetakan ke menu pemakainya", () => {
  assert.deepEqual(picformGate("sop-langkah"), ["/sop-otomasi"]);
  assert.deepEqual(picformGate("raci"), ["/sop-otomasi"]);
  assert.deepEqual(picformGate("raci-karyawan"), ["/people/raci"]);
});

test("koordinasi & pohon hanya untuk Spider Network, bukan SOP & Otomasi", () => {
  assert.deepEqual(picformGate("koordinasi"), ["/network"]);
  assert.deepEqual(picformGate("pohon"), ["/network"]);
});

test("segmen tak dikenal → null (route menolak kecuali admin)", () => {
  assert.equal(picformGate("rahasia"), null);
  assert.equal(picformGate(""), null);
});
