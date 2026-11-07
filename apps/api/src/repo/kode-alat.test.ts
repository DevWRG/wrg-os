import { test } from "node:test";
import assert from "node:assert/strict";

import { isKodeAlat } from "./accurateMirror.js";

test("isKodeAlat: IDS./ADR. = alat, prefix lain (reagen/sparepart/consumable) bukan", () => {
  for (const no of ["IDS.0224", "ADR.0162", "ids.0001", " IDS.0299 "]) assert.equal(isKodeAlat(no), true, no);
  for (const no of ["RKK.0001", "SPA.0010", "AKS.0003", "KNV.0100", "IDS0224", "XIDS.0001", "", null, undefined]) {
    assert.equal(isKodeAlat(no), false, String(no));
  }
});
