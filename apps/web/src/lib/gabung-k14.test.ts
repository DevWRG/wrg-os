import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import { picformGate } from "./picform-access";
import type { SessionUserSrv } from "./admin-guard";

// K14: Spider Network → tab "Peta Koordinasi" di SOP & Peta Koordinasi; dua key tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key network tetap di katalog; /network milik key lama", () => {
  assert.ok(featureCatalog().some((r) => r.key === "network"));
  assert.equal(findNavItem("/network")?.feature, "network");
});

test("accounting (network saja): buka menu, data koordinasi ya, data SOP tidak", () => {
  const acc = u({ network: perm() });
  assert.equal(navGate(acc, findNavItem("/sop-otomasi")!, "/sop-otomasi"), true);
  assert.equal(featureAllowedAny(acc, picformGate("koordinasi")!, "view"), true);
  assert.equal(featureAllowedAny(acc, picformGate("sop-langkah")!, "view"), false);
  assert.equal(featureAllowed(acc, "/network", "view"), true, "graf A9 tetap /network");
});

test("HoD (sop-otomasi saja): data SOP ya, koordinasi/pohon tidak", () => {
  const hod = u({ "sop-otomasi": perm() });
  assert.equal(featureAllowedAny(hod, picformGate("raci")!, "view"), true);
  assert.equal(featureAllowedAny(hod, picformGate("pohon")!, "view"), false);
});
